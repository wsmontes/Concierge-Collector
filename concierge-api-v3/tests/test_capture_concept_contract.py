"""Capture enrichment must preserve the established Curation concept shape."""

import inspect

from app.api import capture


def test_capture_concept_prompt_keeps_explicit_shape_and_price_vocabulary():
    source = inspect.getsource(capture._extract_concepts)

    assert "use listas apenas para cuisine, mood, suitable_for, special_features" in source
    assert 'price_range: "unexpensive", "mid-range" ou "expensive"' in source
    assert "Se não tiver informação suficiente para uma chave, omita a chave" in source
