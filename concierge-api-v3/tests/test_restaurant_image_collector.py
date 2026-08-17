"""
Unit tests for deterministic restaurant image ranking and visual dedupe.

No network is involved here: discovery/download security remains covered by
`test_og_image.py`; this file locks the ranking contract in isolation.
"""

import io

import pytest
from PIL import Image

from app.services.restaurant_image_collector import (
    ImageCandidate,
    prepare_image,
    rank_and_dedupe,
)


def _make_png(width=1200, height=800, color=(160, 80, 40)):
    # Textura determinística (padrão pequeno redimensionado): passa no
    # gate de DETALHE do prepare_image (imagem SÓLIDA é rejeitada como
    # branco/fundo) e cores diferentes geram dhashes diferentes.
    r, g, b = color
    phase = (r * 7 + g * 13 + b * 29) % 256
    small = Image.new("RGB", (32, 32))
    small.putdata(
        [
            (
                (r + (x * 7 + y * 11 + phase)) % 256,
                (g + (x * 3 + y * 5 + phase)) % 256,
                (b + (x * 13 + y * 7 + phase)) % 256,
            )
            for y in range(32)
            for x in range(32)
        ]
    )
    img = small.resize((width, height), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_google_places_photo_can_beat_body_image_when_quality_is_equal():
    body = prepare_image(_make_png(), ImageCandidate("https://site/x.jpg", "website_img", 0))
    places = prepare_image(
        _make_png(color=(40, 100, 160)),
        ImageCandidate("https://places/x", "google_places", 0),
    )
    ranked = rank_and_dedupe([body, places], limit=2)
    assert ranked[0].source == "google_places"


def test_og_photo_beats_body_image_when_quality_is_equal():
    body = prepare_image(
        _make_png(color=(20, 40, 80)),
        ImageCandidate("https://site/body.jpg", "website_img", 0),
    )
    og = prepare_image(
        _make_png(color=(80, 40, 20)),
        ImageCandidate("https://site/hero.jpg", "website_og", 0),
    )
    ranked = rank_and_dedupe([body, og], limit=2)
    assert ranked[0].source == "website_og"


def test_icon_like_brand_color_image_scores_below_real_photo():
    # Regressão Arturito: o og:image era o ÍCONE do WhatsApp (77% dos
    # pixels em verde saturado, CDN sem nome semântico na URL). A
    # heurística de paleta pune a cor de marca dominante — o ícone
    # perde o hero, mas continua na galeria.
    from PIL import ImageDraw

    icon = Image.new("RGB", (600, 600), (37, 211, 102))  # verde WhatsApp
    draw = ImageDraw.Draw(icon)
    draw.ellipse((210, 210, 390, 390), fill=(255, 255, 255))  # glifo branco
    icon_buf = io.BytesIO()
    icon.save(icon_buf, format="PNG")

    icon_img = prepare_image(icon_buf.getvalue(), ImageCandidate("https://cdn.example/og.png", "website_og", 0))
    photo = prepare_image(_make_png(1200, 800, (90, 70, 50)), ImageCandidate("https://site/food.jpg", "website_img", 1))

    assert icon_img.score < photo.score
    assert icon_img.score_components.get("palette", 0) < -10  # penalidade aplicada


def test_prepare_image_rejects_solid_white_blank():
    # Regressão Ryo Gastronomia: um 1080×1080 BRANCO (stddev 0) passava
    # em todos os gates dimensionais e pontuava ACIMA de fotos reais no
    # ranking — o card mostrava um retângulo branco. O gate de DETALHE
    # rejeita imagens sólidas/quase-sólidas.
    solid = Image.new("RGB", (1080, 1080), (255, 255, 255))
    buf = io.BytesIO()
    solid.save(buf, format="PNG")
    with pytest.raises(ValueError):
        prepare_image(buf.getvalue(), ImageCandidate("https://site/blank.jpg", "website_og", 0))


def test_prepare_image_rejects_tiny_square_icon_even_with_valid_aspect():
    # min_dim 100 deixa passar um quadrado 100×100 — é ícone/selo de
    # rodapé, não foto: o gate de ÁREA (40k px²) rejeita.
    with pytest.raises(ValueError):
        prepare_image(
            _make_png(120, 120, (200, 200, 200)),
            ImageCandidate("https://site/icon.png", "website_img", 0),
        )


def test_prepare_image_accepts_normal_square_photo_above_area_gate():
    raw = _make_png(300, 300, (140, 90, 60))
    image = prepare_image(raw, ImageCandidate("https://site/food.jpg", "website_img", 0))
    assert image.width == 300
    assert image.height == 300


def test_prepare_image_rejects_thin_banner():
    try:
        prepare_image(
            _make_png(635, 62),
            ImageCandidate("https://site/banner.jpg", "website_img", 0),
        )
    except ValueError as exc:
        assert "635x62" in str(exc)
    else:
        raise AssertionError("thin banner should be rejected")


def test_rank_and_dedupe_removes_near_duplicate_images():
    raw = _make_png(1000, 700, (120, 90, 70))
    first = prepare_image(raw, ImageCandidate("https://site/a.jpg", "website_og", 0))
    duplicate = prepare_image(raw, ImageCandidate("https://cdn/b.jpg", "google_places", 0))
    ranked = rank_and_dedupe([first, duplicate], limit=8)
    assert len(ranked) == 1


def test_processed_image_is_jpeg_capped_at_768_and_keeps_original_dimensions_metadata():
    image = prepare_image(
        _make_png(2000, 1200),
        ImageCandidate("https://site/hero.jpg", "website_og", 0),
    )
    decoded = Image.open(io.BytesIO(image.jpeg_bytes))
    assert image.width == 2000
    assert image.height == 1200
    assert max(decoded.size) <= 768
    assert decoded.format == "JPEG"
    assert image.score > 0
    assert "source" in image.score_components
