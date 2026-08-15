"""
Testes da validação dura da extração de conceitos (Fase 3 da
modernização de IA) — _canonicalize_categories, sem rede.

O modelo (gpt-5.6) recebe prompt com vocabulário forçado, mas a rede
de segurança server-side garante: chaves fora do vocabulário são
ignoradas, price_range só aceita o canônico e tags saem em lowercase.
"""

from app.services.openai_service import _canonicalize_categories

ALLOWED = {
    "cuisine",
    "menu",
    "food_style",
    "drinks",
    "setting",
    "mood",
    "crowd",
    "suitable_for",
    "special_features",
    "price_and_payment",
    "price_range",
}


def test_tags_sao_lowercased_com_excecoes():
    raw = {"cuisine": ["Italian"], "mood": ["Cozy", "ROMANTIC"], "menu": ["Pizza Margherita"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out["cuisine"] == ["italian"]
    assert out["mood"] == ["cozy", "romantic"]
    assert out["menu"] == ["Pizza Margherita"]  # nomes próprios preservados


def test_price_range_canonico_e_alias():
    raw = {"price_range": ["Moderate"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out["price_range"] == ["mid-range"]

    raw = {"price_range": ["cheap"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out["price_range"] == ["unexpensive"]


def test_price_range_fora_do_vocabulario_e_descartado():
    raw = {"price_range": ["mega caro demais"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert "price_range" not in out


def test_price_range_exatamente_um():
    raw = {"price_range": ["mid-range", "expensive"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out["price_range"] == ["mid-range"]


def test_chaves_fora_do_vocabulario_sao_ignoradas():
    raw = {"occasion": ["business dinner"], "cuisine": ["japanese"], "hack": ["x"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert set(out.keys()) == {"cuisine"}
    assert out["cuisine"] == ["japanese"]


def test_valores_vazios_e_nao_lista_sao_ignorados():
    raw = {"cuisine": "não é lista", "mood": ["", "  ", "cozy"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out == {"mood": ["cozy"]}


def test_price_and_payment_preserva_formato():
    raw = {"price_and_payment": ["R$ 480"]}
    out = _canonicalize_categories(raw, ALLOWED)
    assert out["price_and_payment"] == ["R$ 480"]


def test_clean_restaurant_name_placeholders():
    from app.services.openai_service import _clean_restaurant_name

    assert _clean_restaurant_name("Unknown") is None
    assert _clean_restaurant_name("N/A") is None
    assert _clean_restaurant_name("  ") is None
    assert _clean_restaurant_name(None) is None
    assert _clean_restaurant_name(42) is None


def test_clean_restaurant_name_valida_e_longa():
    from app.services.openai_service import _clean_restaurant_name

    assert _clean_restaurant_name("  Trattoria del Centro ") == "Trattoria del Centro"
    assert _clean_restaurant_name("x" * 150) is None  # frase inteira, não nome
