"""
Deterministic ranking primitives for restaurant image collection.

This module is intentionally network-agnostic: discovery/download remain in
og_image_service so its SSRF guard, retry policy and byte caps stay the single
network boundary. Here we validate decoded images, create card JPEGs, score
candidates and remove visual duplicates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import io
import math
from typing import Dict, Iterable, List
from urllib.parse import urlsplit

from PIL import Image, ImageFilter, ImageStat

# Pesos de fonte (rebalanceio ago/2026): og:image recebia 40 pontos de
# confiança cega — sites usam o og para logo/ícone/placeholder (casos
# reais: Ryo branco, Arturito com ícone de WhatsApp). Fotos de conteúdo
# do site (website_img) subiram para competir com as do Places.
SOURCE_WEIGHTS: Dict[str, float] = {
    "website_og": 34.0,
    "google_places": 34.0,
    "website_twitter": 30.0,
    "website_schema": 28.0,
    "website_jsonld": 26.0,
    "website_img": 26.0,
    "website": 24.0,
}

NEGATIVE_URL_MARKERS = (
    "logo",
    "icon",
    "banner",
    "header",
    "footer",
    "placeholder",
    "sprite",
    "avatar",
    "default-image",
    # identidade de terceiros/UI: badges de pagamento, botões de
    # parceria e selos patrocinados costumam viver no rodapé dos sites
    "badge",
    "button",
    "payment",
    "partner",
    "sponsor",
    "cookie",
    # ícones de redes sociais (quando a URL os nomeia; CDNs sem nome
    # semântico caem na heurística de paleta)
    "whatsapp",
    "wpp",
    "social",
    "share-icon",
)
POSITIVE_URL_MARKERS = (
    "hero",
    "gallery",
    "food",
    "dish",
    "interior",
    "restaurant",
    "dining",
    "menu-item",
)


@dataclass(frozen=True)
class ImageCandidate:
    """A discovered image before download/validation."""

    url: str
    source: str
    source_index: int = 0


@dataclass
class CollectedImage:
    """A validated, ranked image safe to proxy to clients."""

    jpeg_bytes: bytes
    source: str
    width: int
    height: int
    byte_size: int
    score: float
    score_components: Dict[str, float] = field(default_factory=dict)
    perceptual_hash: int = 0
    source_index: int = 0

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height if self.height else 0.0

    def public_metadata(self, rank: int, image_url: str) -> dict:
        return {
            "rank": rank,
            "source": self.source,
            "width": self.width,
            "height": self.height,
            "aspect_ratio": round(self.aspect_ratio, 3),
            "score": round(self.score, 2),
            "score_components": {k: round(v, 2) for k, v in self.score_components.items()},
            "image_url": image_url,
        }


# Desvio-padrão mínimo do luminance: uma imagem SÓLIDA (branco absoluto,
# cor chapada, placeholder de fundo) nunca é foto de card — o gate de
# tamanho/aspecto não pega esses casos (um 1080×1080 branco é quadrado
# "perfeito" e pontuava ACIMA de fotos reais no ranking).
MIN_PHOTO_DETAIL = 8.0


def _detail_stddev(img: Image.Image) -> float:
    """Desvio-padrão do luminance em miniatura 64px — proxy de detalhe."""
    thumb = img.convert("L").resize((64, 64), Image.Resampling.BILINEAR)
    return float(ImageStat.Stat(thumb).stddev[0])


# Heurística de "cor de marca" (caso real: Arturito — o og:image do site
# é o ÍCONE do WhatsApp: 77% dos pixels num verde saturado; URLs de CDN
# sem nome semântico escapam dos marcadores de URL). Ícones/logos cobrem
# a imagem com UMA cor saturada dominante; fotos reais têm paleta
# distribuída. Penalidade suave no score — o ícone perde a disputa do
# hero, mas continua disponível na galeria.
ICON_PALETTE_DOMINANCE = 0.60
ICON_PALETTE_SATURATION = 0.35
ICON_PALETTE_PENALTY = 24.0


def _palette_signal(img: Image.Image) -> float:
    """Penalidade (0..ICON_PALETTE_PENALTY) para paleta dominada por uma
    única cor saturada — assinatura de ícone/logo de marca."""
    small = img.resize((16, 16), Image.Resampling.BILINEAR)
    quantized = small.quantize(colors=12, method=Image.Quantize.MEDIANCUT)
    colors = quantized.getcolors()
    if not colors:
        return 0.0
    dominant_count, dominant_index = max(colors, key=lambda pair: pair[0])
    share = dominant_count / (16 * 16)
    if share < ICON_PALETTE_DOMINANCE:
        return 0.0
    palette = quantized.getpalette() or []
    r = palette[dominant_index * 3]
    g = palette[dominant_index * 3 + 1]
    b = palette[dominant_index * 3 + 2]
    mx, mn = max(r, g, b), min(r, g, b)
    saturation = (mx - mn) / mx if mx else 0.0
    if saturation < ICON_PALETTE_SATURATION:
        return 0.0
    return ICON_PALETTE_PENALTY * min(1.0, share / 0.85)


# Bônus de "cara de fotografia" (caso real: Arturito — o site publica o
# ÍCONE do WhatsApp em 600 E 1920px como imagem de conteúdo; o ícone
# grande ganhava do hero pela RESOLUÇÃO). Fotografias têm textura
# distribuída (energia de borda alta em toda a miniatura) e entropia de
# histograma alta; logos/ícones têm áreas chapadas (grad baixo) e
# paleta pobre (entropia baixa). Calibrado nos candidatos reais do
# site do Arturito: ícones grad≈28/ent≈6.4; fotos grad 32–51/ent 7.3+.
PHOTO_TEXTURE_FLOOR = 26.0
PHOTO_TEXTURE_FULL = 52.0
PHOTO_ENTROPY_FLOOR = 6.5
PHOTO_BONUS = 20.0


def _photo_likeness(img: Image.Image) -> float:
    """Score 0..PHOTO_BONUS: privilégio para fotografias sobre logos."""
    thumb = img.convert("L").resize((64, 64), Image.Resampling.BILINEAR)
    edges = thumb.filter(ImageFilter.FIND_EDGES)
    grad = float(ImageStat.Stat(edges).mean[0])
    raw = max(0.0, min((grad - PHOTO_TEXTURE_FLOOR) / (PHOTO_TEXTURE_FULL - PHOTO_TEXTURE_FLOOR), 1.0))
    total = 64 * 64
    hist = thumb.histogram()
    probs = [h / total for h in hist]
    entropy = -sum(p * math.log2(p) for p in probs if p > 0)
    if entropy < PHOTO_ENTROPY_FLOOR:
        raw *= 0.25
    return raw * PHOTO_BONUS


def _dhash(img: Image.Image) -> int:
    """64-bit difference hash; robust enough to collapse CDN/resized copies."""
    gray = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    # get_flattened_data() foi removido no Pillow 10+ — getdata() é o
    # equivalente estável para imagens "L" (lista plana de valores).
    pixels = list(gray.getdata())
    value = 0
    for row in range(8):
        offset = row * 9
        for col in range(8):
            value = (value << 1) | int(pixels[offset + col] > pixels[offset + col + 1])
    return value


def _hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _score_candidate(candidate: ImageCandidate, img: Image.Image) -> tuple[float, Dict[str, float]]:
    width, height = img.size
    aspect = width / height

    source_score = SOURCE_WEIGHTS.get(candidate.source, 18.0)
    source_order = -min(max(candidate.source_index, 0), 20) * 0.35

    megapixels = (width * height) / 1_000_000.0
    resolution = min(megapixels / 2.5, 1.0) * 18.0

    # Hero/card sweet spot is landscape around 3:2. Square remains usable;
    # very wide and portrait photos lose points but are not hard-rejected.
    aspect_distance = abs(math.log(max(aspect, 0.01) / 1.5))
    aspect_score = max(0.0, 14.0 - aspect_distance * 11.0)

    # Low-variance assets are commonly logos/placeholders. This is a small
    # signal only; source + dimensions remain more important.
    stddev = _detail_stddev(img)
    detail = min(stddev / 64.0, 1.0) * 8.0

    path = urlsplit(candidate.url).path.lower()
    url_signal = 0.0
    if any(marker in path for marker in NEGATIVE_URL_MARKERS):
        url_signal -= 24.0
    if any(marker in path for marker in POSITIVE_URL_MARKERS):
        url_signal += 3.0

    palette_penalty = _palette_signal(img)
    photo_bonus = _photo_likeness(img)

    components = {
        "source": source_score,
        "source_order": source_order,
        "resolution": resolution,
        "aspect": aspect_score,
        "detail": detail,
        "url_signal": url_signal,
        "palette": -palette_penalty,
        "photo": photo_bonus,
    }
    return sum(components.values()), components


def prepare_image(
    raw: bytes,
    candidate: ImageCandidate,
    *,
    max_dim: int = 768,
    quality: int = 82,
    min_dim: int = 100,
    max_aspect: float = 3.5,
    # 20k px² = 200×100, o piso do contrato legado de resize (imagens
    # "pequenas" válidas passam); abaixo disso é ícone/botão/selo
    min_area: int = 20_000,
) -> CollectedImage:
    """Validate/decode one candidate, produce the cached JPEG and its score."""
    with Image.open(io.BytesIO(raw)) as opened:
        opened.load()
        width, height = opened.size
        if min(width, height) < min_dim or max(width, height) / min(width, height) > max_aspect:
            raise ValueError(f"imagem fora do gate do card: {width}x{height}")
        # Gate de área: um quadrado de 100×100 passa no min_dim, mas é
        # ícone/logo de rodapé, não foto — a área mínima rejeita esses
        # sem tocar em fotos reais (raro algo abaixo de 200×200).
        if width * height < min_area:
            raise ValueError(f"imagem pequena demais para foto: {width}x{height}")

        rgb = opened.convert("RGB")

        # Gate de detalhe: imagem sólida/quase-sólida (branco absoluto,
        # fundo chapado) passa em todos os gates dimensionais e ainda
        # pontuava alto no ranking — nunca é foto de card. O stddev do
        # luminance em miniatura é o discriminador barato e confiável.
        if _detail_stddev(rgb) < MIN_PHOTO_DETAIL:
            raise ValueError("imagem sem detalhe (branco/sólido) — não é foto")

        score, components = _score_candidate(candidate, rgb)
        perceptual_hash = _dhash(rgb)

        output = rgb.copy()
        output.thumbnail((max_dim, max_dim))
        out = io.BytesIO()
        output.save(out, format="JPEG", quality=quality, optimize=True)
        jpeg = out.getvalue()

    return CollectedImage(
        jpeg_bytes=jpeg,
        source=candidate.source,
        width=width,
        height=height,
        byte_size=len(raw),
        score=score,
        score_components=components,
        perceptual_hash=perceptual_hash,
        source_index=candidate.source_index,
    )


def rank_and_dedupe(
    images: Iterable[CollectedImage],
    *,
    limit: int = 8,
    duplicate_distance: int = 5,
) -> List[CollectedImage]:
    """Sort by quality and remove exact/near visual duplicates."""
    ranked = sorted(images, key=lambda image: (-image.score, image.source_index, image.source))
    selected: List[CollectedImage] = []
    for image in ranked:
        if any(
            _hamming_distance(image.perceptual_hash, kept.perceptual_hash) <= duplicate_distance for kept in selected
        ):
            continue
        selected.append(image)
        if len(selected) >= limit:
            break
    return selected
