"""Async Capture endpoints must not run synchronous provider calls on the event loop."""

import inspect


def test_capture_entity_matching_runs_off_event_loop():
    from app.api.capture import capture

    source = inspect.getsource(capture)
    assert "await asyncio.to_thread(_match_entities, db, restaurant_name)" in source


def test_confirm_google_place_enrichment_runs_off_event_loop():
    from app.api.capture import confirm_capture

    source = inspect.getsource(confirm_capture)
    assert "await asyncio.to_thread(_create_entity_from_place, matched_entity, db)" in source
