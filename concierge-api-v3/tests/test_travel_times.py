"""
File: test_travel_times.py
Purpose: POST /api/v3/routes/travel-times — travel time from a guest to a restaurant (Google Routes API).
Dependencies: app.api.travel (Google is faked at the httpx boundary; no network).

The Google key stays server-side, each travel mode is one Routes request, driving uses live traffic
(TRAFFIC_AWARE_OPTIMAL), a failing mode does not take the others down and never leaks provider text.
"""

import datetime as dt

import httpx
import pytest

import app.api.travel as travel
from app.core.config import settings

API_KEY = "test-routes-key"
GOOGLE_KEY = "google-secret-key"
ORIGIN = {"latitude": -23.5614, "longitude": -46.6559}
PLACE_ID = "ChIJabcdefghijklmnop"


class _Response:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeGoogle:
    """Answers computeRoutes per travel mode and records every request."""

    def __init__(self):
        self.requests: list[dict] = []
        self.answers = {
            "DRIVE": _Response(
                200, {"routes": [{"duration": "1560s", "staticDuration": "840s", "distanceMeters": 6100}]}
            ),
            "WALK": _Response(200, {"routes": [{"duration": "4440s", "distanceMeters": 5800}]}),
            "TRANSIT": _Response(
                200,
                {
                    "routes": [
                        {
                            "duration": "1860s",
                            "distanceMeters": 6400,
                            "legs": [
                                {
                                    "steps": [
                                        {"travelMode": "WALK", "staticDuration": "300s"},
                                        {
                                            "travelMode": "TRANSIT",
                                            "staticDuration": "900s",
                                            "transitDetails": {
                                                "transitLine": {
                                                    "name": "Linha 4-Amarela",
                                                    "nameShort": "4",
                                                    "vehicle": {"type": "SUBWAY"},
                                                },
                                                "stopDetails": {
                                                    "departureStop": {"name": "Paulista"},
                                                    "arrivalStop": {"name": "Faria Lima"},
                                                },
                                            },
                                        },
                                        {"travelMode": "WALK", "staticDuration": "480s"},
                                    ]
                                }
                            ],
                        }
                    ]
                },
            ),
        }

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, json=None, headers=None):
        self.requests.append({"url": url, "json": json, "headers": headers})
        return self.answers[json["travelMode"]]

    def by_mode(self, mode: str) -> dict:
        return next(r for r in self.requests if r["json"]["travelMode"] == mode)


@pytest.fixture
def google(monkeypatch):
    fake = _FakeGoogle()
    monkeypatch.setattr(settings, "admin_api_keys", API_KEY)
    monkeypatch.setattr(settings, "google_places_api_key", GOOGLE_KEY)
    monkeypatch.setattr(travel.httpx, "AsyncClient", fake)
    return fake


def _post(client, body, key=API_KEY):
    headers = {"X-API-Key": key} if key else {}
    return client.post("/api/v3/routes/travel-times", json=body, headers=headers)


def test_driving_uses_live_traffic_and_reports_how_much_it_costs(client, google):
    response = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive"]})

    assert response.status_code == 200
    drive = response.json()["modes"]["drive"]
    assert drive == {"minutes": 26, "minutes_without_traffic": 14, "km": 6.1, "traffic": "heavy"}
    request = google.by_mode("DRIVE")
    assert request["url"] == "https://routes.googleapis.com/directions/v2:computeRoutes"
    assert request["json"]["routingPreference"] == "TRAFFIC_AWARE_OPTIMAL"
    assert request["json"]["destination"] == {"placeId": PLACE_ID}
    assert request["json"]["origin"] == {"location": {"latLng": ORIGIN}}
    assert "routes.staticDuration" in request["headers"]["X-Goog-FieldMask"]
    assert request["headers"]["X-Goog-Api-Key"] == GOOGLE_KEY


def test_the_google_key_never_reaches_the_caller(client, google):
    response = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive", "walk"]})

    assert GOOGLE_KEY not in response.text


def test_walking_has_no_traffic_preference(client, google):
    response = _post(
        client, {"origin": ORIGIN, "destination": {"latitude": -23.58, "longitude": -46.68}, "modes": ["walk"]}
    )

    assert response.json()["modes"]["walk"] == {"minutes": 74, "km": 5.8}
    request = google.by_mode("WALK")
    assert "routingPreference" not in request["json"]
    assert request["json"]["destination"] == {"location": {"latLng": {"latitude": -23.58, "longitude": -46.68}}}


def test_transit_names_the_lines_the_stops_and_the_walking(client, google):
    transit = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["transit"]}).json()["modes"][
        "transit"
    ]

    assert transit["minutes"] == 31 and transit["km"] == 6.4
    assert transit["walk_minutes"] == 13 and transit["transfers"] == 0
    assert transit["lines"] == [
        {"line": "Linha 4-Amarela", "vehicle": "SUBWAY", "from": "Paulista", "to": "Faria Lima"}
    ]
    assert "routingPreference" not in google.by_mode("TRANSIT")["json"]


@pytest.mark.parametrize(
    ("with_traffic", "without", "band"),
    [("900s", "840s", "light"), ("1100s", "840s", "moderate"), ("1560s", "840s", "heavy")],
)
def test_traffic_band_comes_from_the_delay_it_adds(client, google, with_traffic, without, band):
    google.answers["DRIVE"] = _Response(
        200, {"routes": [{"duration": with_traffic, "staticDuration": without, "distanceMeters": 6100}]}
    )

    assert (
        _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive"]}).json()["modes"][
            "drive"
        ]["traffic"]
        == band
    )


def test_a_future_departure_is_sent_and_a_past_one_means_now(client, google):
    future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=20)).replace(microsecond=0)
    body = {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive", "transit"]}

    ahead = _post(client, {**body, "departure_time": future.isoformat()}).json()
    assert google.by_mode("DRIVE")["json"]["departureTime"] == future.isoformat().replace("+00:00", "Z")
    assert google.by_mode("TRANSIT")["json"]["departureTime"] == future.isoformat().replace("+00:00", "Z")
    assert ahead["departure"] == future.isoformat().replace("+00:00", "Z")

    google.requests.clear()
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()
    now = _post(client, {**body, "departure_time": past}).json()
    assert all("departureTime" not in r["json"] for r in google.requests) and now["departure"] == "now"


def test_one_failing_mode_does_not_take_the_others_down_or_leak_the_provider(client, google):
    google.answers["TRANSIT"] = _Response(403, {"error": {"message": f"API key {GOOGLE_KEY} not allowed"}})

    response = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive", "transit"]})

    assert response.status_code == 200
    modes = response.json()["modes"]
    assert modes["drive"]["minutes"] == 26
    assert modes["transit"] == {"error": "provider_403"}
    assert GOOGLE_KEY not in response.text


@pytest.mark.parametrize(
    "content",
    [b"not JSON", b'{"routes": "invalid"}', b'{"routes": [{"legs": [null]}]}'],
    ids=["invalid-json", "invalid-routes", "invalid-transit-leg"],
)
def test_invalid_provider_response_only_affects_its_mode(client, google, content):
    google.answers["TRANSIT"] = httpx.Response(200, content=content)

    response = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive", "transit"]})

    assert response.status_code == 200
    modes = response.json()["modes"]
    assert modes["drive"]["minutes"] == 26
    assert modes["transit"] == {"error": "provider_invalid_response"}


@pytest.mark.parametrize(
    "distance",
    [b"Infinity", b"NaN", b"true"],
    ids=["infinity", "nan", "boolean"],
)
def test_a_distance_that_is_not_a_finite_number_is_left_out(client, google, distance):
    google.answers["TRANSIT"] = httpx.Response(
        200, content=b'{"routes": [{"duration": "600s", "distanceMeters": ' + distance + b"}]}"
    )

    response = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["drive", "transit"]})

    assert response.status_code == 200
    modes = response.json()["modes"]
    assert modes["drive"]["minutes"] == 26
    assert modes["transit"]["minutes"] == 10
    assert modes["transit"]["km"] is None


def test_no_route_is_reported_as_unavailable(client, google):
    google.answers["TRANSIT"] = _Response(200, {})

    modes = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["transit"]}).json()["modes"]

    assert modes["transit"] == {"available": False}


def test_it_requires_authentication(client, google):
    assert _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID}, key=None).status_code == 401
    assert google.requests == []


@pytest.mark.parametrize(
    "body",
    [
        {"origin": ORIGIN},
        {"origin": ORIGIN, "destination_place_id": PLACE_ID, "destination": ORIGIN},
        {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": ["fly"]},
        {"origin": ORIGIN, "destination_place_id": PLACE_ID, "modes": []},
        {"origin": {"latitude": 123, "longitude": 0}, "destination_place_id": PLACE_ID},
        {"origin": ORIGIN, "destination_place_id": "../../v1/secret"},
    ],
    ids=["no-destination", "two-destinations", "unknown-mode", "no-mode", "bad-coordinates", "bad-place-id"],
)
def test_invalid_requests_are_rejected_before_any_google_call(client, google, body):
    assert _post(client, body).status_code == 422
    assert google.requests == []


def test_default_modes_are_driving_and_transit(client, google):
    modes = _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID}).json()["modes"]

    assert set(modes) == {"drive", "transit"}


def test_without_a_google_key_it_says_so(client, google, monkeypatch):
    monkeypatch.setattr(settings, "google_places_api_key", "")

    assert _post(client, {"origin": ORIGIN, "destination_place_id": PLACE_ID}).status_code == 503
