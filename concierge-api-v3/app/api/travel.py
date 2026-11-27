"""
File: travel.py
Purpose: Travel time from a point to a place, by car (live traffic), on foot and by public transport,
    through the Google Routes API (computeRoutes). The Google key stays server-side.
Dependencies: fastapi, httpx, pydantic, app.core.config (google_places_api_key: the Routes API must be
    enabled for that key's Google Cloud project), app.core.security, app.core.rate_limit.

One Routes request per travel mode, in parallel:
- drive: routingPreference TRAFFIC_AWARE_OPTIMAL (the mode Google Maps itself uses); duration is with
  traffic, staticDuration without; the traffic band comes from the delay traffic adds.
- walk: no routing preference (Google does not accept one for walking).
- transit: lines, stops, transfers and the minutes walked.
A failing mode returns a provider error code and never the provider's text (it may echo the key).
Billing (Nov 2026, Google pricing list): a request with traffic is a Compute Routes Pro event, the others
Essentials; each request is one billable event.
"""

# No `from __future__ import annotations`: behind @limiter.limit, FastAPI would read the body as a query.
import asyncio
import datetime as dt
import logging
import math
import re
from typing import Any, List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import require_role, verify_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/routes", tags=["routes"])

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
TIMEOUT_S = 8.0
_PLACE_ID = re.compile(r"^[A-Za-z0-9_-]{10,300}$")
_GOOGLE_MODE = {"drive": "DRIVE", "walk": "WALK", "transit": "TRANSIT"}
_FIELDS = {
    "drive": "routes.duration,routes.staticDuration,routes.distanceMeters",
    "walk": "routes.duration,routes.distanceMeters",
    "transit": ",".join(
        [
            "routes.duration",
            "routes.distanceMeters",
            "routes.legs.steps.travelMode",
            "routes.legs.steps.staticDuration",
            "routes.legs.steps.transitDetails.transitLine.name",
            "routes.legs.steps.transitDetails.transitLine.nameShort",
            "routes.legs.steps.transitDetails.transitLine.vehicle.type",
            "routes.legs.steps.transitDetails.stopDetails.departureStop.name",
            "routes.legs.steps.transitDetails.stopDetails.arrivalStop.name",
        ]
    ),
}


class LatLng(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class TravelTimesRequest(BaseModel):
    origin: LatLng
    destination_place_id: Optional[str] = Field(default=None, description="Google place id of the destination.")
    destination: Optional[LatLng] = None
    modes: List[Literal["drive", "walk", "transit"]] = Field(
        default_factory=lambda: ["drive", "transit"], min_length=1, max_length=3
    )
    departure_time: Optional[dt.datetime] = Field(
        default=None, description="Future departure (traffic and timetables for then); past or absent = now."
    )
    language: str = Field(default="pt-BR", max_length=10)

    @model_validator(mode="after")
    def one_destination(self) -> "TravelTimesRequest":
        if (self.destination_place_id is None) == (self.destination is None):
            raise ValueError("give exactly one of destination_place_id or destination")
        if self.destination_place_id is not None and not _PLACE_ID.match(self.destination_place_id):
            raise ValueError("invalid destination_place_id")
        return self


def _seconds(value: Any) -> int | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(value or ""))
    return round(float(match.group(1))) if match else None


def _minutes(seconds: int | None) -> int | None:
    return None if seconds is None else max(1, round(seconds / 60))


def _km(meters: Any) -> float | None:
    # bool is an int, and the JSON parser accepts Infinity/NaN, which the response cannot serialize.
    if isinstance(meters, bool) or not isinstance(meters, int | float) or not math.isfinite(meters):
        return None
    return round(float(meters) / 1000, 1)


def _traffic_band(with_traffic: int | None, without: int | None) -> str | None:
    if not with_traffic or not without:
        return None
    ratio = with_traffic / without
    return "light" if ratio <= 1.15 else "moderate" if ratio <= 1.5 else "heavy"


def _waypoint(point: LatLng | None, place_id: str | None) -> dict[str, Any]:
    if place_id:
        return {"placeId": place_id}
    assert point is not None
    return {"location": {"latLng": {"latitude": point.latitude, "longitude": point.longitude}}}


def _departure(requested: dt.datetime | None) -> str | None:
    """RFC 3339 in UTC for a departure still in the future; Google rejects past ones (None = now)."""
    if requested is None:
        return None
    moment = requested if requested.tzinfo else requested.replace(tzinfo=dt.timezone.utc)
    if moment <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=1):
        return None
    return moment.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _shape(mode: str, route: dict[str, Any]) -> dict[str, Any]:
    duration = _seconds(route.get("duration"))
    shaped: dict[str, Any] = {"minutes": _minutes(duration), "km": _km(route.get("distanceMeters"))}
    if mode == "drive":
        without = _seconds(route.get("staticDuration"))
        shaped = {
            "minutes": shaped["minutes"],
            "minutes_without_traffic": _minutes(without),
            "km": shaped["km"],
            "traffic": _traffic_band(duration, without),
        }
    elif mode == "transit":
        steps = [step for leg in route.get("legs") or [] for step in leg.get("steps") or []]
        rides = [step for step in steps if step.get("travelMode") == "TRANSIT"]
        walked = sum(_seconds(step.get("staticDuration")) or 0 for step in steps if step.get("travelMode") == "WALK")
        shaped["walk_minutes"] = _minutes(walked) if walked else 0
        shaped["transfers"] = max(0, len(rides) - 1)
        shaped["lines"] = [
            {
                "line": (ride.get("transitDetails") or {}).get("transitLine", {}).get("name")
                or (ride.get("transitDetails") or {}).get("transitLine", {}).get("nameShort"),
                "vehicle": ((ride.get("transitDetails") or {}).get("transitLine", {}).get("vehicle") or {}).get("type"),
                "from": ((ride.get("transitDetails") or {}).get("stopDetails", {}).get("departureStop") or {}).get(
                    "name"
                ),
                "to": ((ride.get("transitDetails") or {}).get("stopDetails", {}).get("arrivalStop") or {}).get("name"),
            }
            for ride in rides
        ]
    return shaped


async def _one_mode(client: Any, mode: str, body: TravelTimesRequest, departure: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "origin": _waypoint(body.origin, None),
        "destination": _waypoint(body.destination, body.destination_place_id),
        "travelMode": _GOOGLE_MODE[mode],
        "languageCode": body.language,
        "units": "METRIC",
    }
    if mode == "drive":
        payload["routingPreference"] = "TRAFFIC_AWARE_OPTIMAL"
    if departure and mode in ("drive", "transit"):
        payload["departureTime"] = departure
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": _FIELDS[mode],
    }
    try:
        response = await client.post(ROUTES_URL, json=payload, headers=headers)
    except Exception as error:  # noqa: BLE001 - one mode failing must not take the others down
        logger.warning("[Routes] %s request failed: %s", mode, type(error).__name__)
        return {"error": "provider_unreachable"}
    if response.status_code != 200:
        # The provider's text is never logged or returned: it may echo the request (and the key).
        logger.warning("[Routes] %s answered HTTP %s", mode, response.status_code)
        return {"error": f"provider_{response.status_code}"}
    try:
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("expected a response object")
        routes = payload.get("routes")
        if routes is None:
            return {"available": False}
        if not isinstance(routes, list):
            raise ValueError("expected a list of routes")
        return _shape(mode, routes[0]) if routes else {"available": False}
    except (ValueError, TypeError, AttributeError, OverflowError):
        logger.warning("[Routes] %s returned an invalid response", mode)
        return {"error": "provider_invalid_response"}


@router.post("/travel-times", dependencies=[Depends(require_role("viewer"))])
@limiter.limit("30/minute")
async def travel_times(
    request: Request,
    body: TravelTimesRequest,
    auth: dict = Depends(verify_auth),
):
    """
    Travel time from **origin** to a place (Google place id or coordinates), per travel mode.

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`

    Example body: `{"origin": {"latitude": -23.56, "longitude": -46.65},
    "destination_place_id": "ChIJ...", "modes": ["drive", "transit"]}`
    """
    if not (settings.google_places_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Google API key not configured on server")
    departure = _departure(body.departure_time)
    modes = list(dict.fromkeys(body.modes))
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        results = await asyncio.gather(*(_one_mode(client, mode, body, departure) for mode in modes))
    logger.info("[Routes] travel times: modes=%s departure=%s", ",".join(modes), "planned" if departure else "now")
    return {
        "modes": dict(zip(modes, results)),
        "departure": departure or "now",
        "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
