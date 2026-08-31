"""Paid Capture surfaces must have explicit credential-scoped limits."""

import inspect


def test_capture_upload_has_paid_provider_rate_limit():
    import app.api.capture as capture_module

    source = inspect.getsource(capture_module)
    assert '@limiter.limit("10/minute", key_func=auth_header_key)' in source


def test_capture_confirm_has_enrichment_rate_limit():
    import app.api.capture as capture_module

    source = inspect.getsource(capture_module)
    assert '@limiter.limit("20/minute", key_func=auth_header_key)' in source
