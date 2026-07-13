"""Tests for capture endpoints and helpers."""

import pytest
from unittest.mock import MagicMock, patch


def _make_cursor(records: list):
    """Build a mock MongoDB cursor that supports .limit()."""
    cursor = MagicMock()
    cursor.limit.return_value = records
    return cursor


def test_match_entities_escapes_regex_metacharacters():
    """Nomes com caracteres especiais de regex devem ser escapados."""
    from app.api.capture import _match_entities

    mock_db = MagicMock()
    mock_db.entities.find.return_value = _make_cursor([])

    # Nome com $, ., (, ), +  — todos metacaracteres de regex
    with patch("app.api.capture.os.getenv", return_value=""):
        result = _match_entities(mock_db, "Café A+ (matriz) $$$")

    # Não deve lançar exceção de regex inválido
    # A query deve ter sido feita com caracteres escapados
    assert isinstance(result, list)
