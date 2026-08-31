from fastapi import HTTPException

from app.core.http_error_contract import http_exception_content


def test_ownership_forbidden_detail_gets_machine_readable_code():
    exc = HTTPException(status_code=403, detail="Cannot modify another curator's curation")

    assert http_exception_content(exc) == {
        "detail": {
            "code": "curation_owner_mismatch",
            "message": "Cannot modify another curator's curation",
        }
    }


def test_generic_403_remains_generic_and_is_not_reclassified_as_ownership():
    exc = HTTPException(status_code=403, detail="Insufficient role")

    assert http_exception_content(exc) == {"detail": "Insufficient role"}


def test_existing_structured_detail_is_preserved():
    detail = {"code": "role_required", "message": "Administrator role required"}
    exc = HTTPException(status_code=403, detail=detail)

    assert http_exception_content(exc) == {"detail": detail}
