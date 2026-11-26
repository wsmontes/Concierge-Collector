"""
File: menu_reading.py
Purpose: read a restaurant's website as plain text — its links (with how promising each one is for a
    concierge), its sitemap, page titles, PDFs — and find its menu documents.
Dependencies: pypdf (PDF text), stdlib html/re. Network-agnostic: the caller downloads (through the
    SSRF-safe boundary in og_image_service) and hands bytes here.

A restaurant's menu is often several documents — food, wine list, drinks, lunch/executive, desserts —
so every link that looks like a menu is kept, ranked (PDF first: it is the menu itself), with what it
probably covers. Reservations, contact, social and script links are not menus. Text extraction never
raises: a document that cannot be read is empty, and the caller decides what that means.
"""

from __future__ import annotations

import html as html_lib
import io
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import List
from urllib.parse import urljoin, urlsplit

logger = logging.getLogger(__name__)
# pypdf warns at length about fonts it cannot fully decode (the text still comes out); keep the log useful.
logging.getLogger("pypdf").setLevel(logging.ERROR)

MAX_PDF_PAGES = 40

# Hosts that serve menus as an app/page of their own.
MENU_PLATFORMS = (
    "goomer",
    "menudino",
    "anota.ai",
    "menu.app",
    "cardapioweb",
    "olaclick",
    "menuvem",
    "issuu",
    "flipsnack",
    "yumpu",
    "canva",
    "drive.google",
    "dropbox",
)
_NOT_MENU_HOSTS = ("instagram.com", "facebook.com", "wa.me", "whatsapp.com", "tiktok.com", "youtube.com")
_MENU_WORDS = re.compile(
    r"card[aá]pio|cardapio|\bmenus?\b|\bcarta\b|vinhos?|wines?|drinks?|bebidas|coquet[eé]is|cocktails?|"
    r"almo[cç]o|executivo|sobremesas?|desserts?|degusta[cç][aã]o|tasting",
    re.I,
)
_COVERS = (
    ("delivery", re.compile(r"delivery|ifood|para[-_ ]levar|takeaway|take[-_ ]away", re.I)),
    ("wine", re.compile(r"vinhos?|wines?|\bcarta[-_ ]de[-_ ]vinhos\b", re.I)),
    ("drinks", re.compile(r"drinks?|bebidas|coquet[eé]is|cocktails?|\bbar\b", re.I)),
    ("lunch", re.compile(r"almo[cç]o|almoco|lunch|executivo|executive", re.I)),
    ("dessert", re.compile(r"sobremesas?|desserts?|doces", re.I)),
    ("tasting", re.compile(r"degusta[cç][aã]o|degustacao|tasting", re.I)),
)
_ANCHOR = re.compile(r"<a\b[^>]*?href\s*=\s*[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
_CODE = re.compile(r"<(script|style|noscript|svg)\b.*?</\1>", re.I | re.S)
_BREAKS = re.compile(r"<\s*(br|/p|/div|/li|/tr|/h[1-6]|/section|/article)\b[^>]*>", re.I)
# "260,00", "1249,00", "1.249,00", "R$ 36", "R$36,50" — not phone numbers, years or times.
_PRICE = re.compile(r"R\$\s?\d{1,5}(?:[.,]\d{2})?|(?<![\d(-])(?:\d{1,3}(?:\.\d{3})+|\d{1,5}),\d{2}(?!\d)")


_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
_ASSET = re.compile(r"\.(jpe?g|png|gif|webp|svg|ico|css|js|zip|mp4|mp3|woff2?|ttf|xml|json|txt|docx?|xlsx?)$", re.I)
_SKIP_PATH = re.compile(
    r"/(wp-json|wp-admin|wp-login|feed|tag|author|cart|carrinho|checkout|account|minha-conta|login|search|busca)\b"
    r"|replytocom|add-to-cart|/page/\d+",
    re.I,
)
# What a concierge looks for on a restaurant's site (menu, booking, hours, events, the house, policies).
_USEFUL_WORDS = re.compile(
    r"card[aá]pio|menu|carta|vinho|wine|drink|bebida|reserv|sobre|about|quem-somos|hist[oó]ria|chef|"
    r"evento|event|privativ|private|sal[aã]o|contato|contact|hor[aá]rio|hours|faq|d[uú]vida|pol[ií]tica|"
    r"unidade|localiza|endere|almo[cç]o|jantar|degusta|brunch|kids|crian",
    re.I,
)
_NOISE_PATH = re.compile(r"/(blog|noticias|news|imprensa|press|\d{4}/\d{2})/", re.I)
_OFFSITE_NOT_USEFUL = re.compile(r"instagram|facebook|wa\.me|whatsapp|tiktok|youtube|ifood|google|twitter|x\.com", re.I)


def site_root(url: str) -> str:
    """The host without "www." — pages under it (and its subdomains) are the same site."""
    host = urlsplit(url).netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def same_site(url: str, root: str) -> bool:
    host = site_root(url)
    return host == root or host.endswith("." + root)


def site_links(raw: bytes, base_url: str) -> List[tuple]:
    """(absolute url, link text) of every followable link on the page: the site's own pages, and menu
    platforms elsewhere (meemo, getin, goomer...). Assets, account/cart pages and social networks are not."""
    page = raw.decode("utf-8", "ignore")
    root = site_root(base_url)
    found: dict = {}
    for href, inner in _ANCHOR.findall(page):
        href = html_lib.unescape(href.strip())
        if href.lower().startswith(("mailto:", "tel:", "javascript:", "whatsapp:")):
            continue
        url = urljoin(base_url, href).split("#")[0]
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or "." not in parts.netloc:
            continue
        if re.search(r"https?[:/]", parts.netloc + parts.path[:12]):
            continue  # broken links seen on real sites, e.g. "https://mhttps://menu.example/..."
        if (_ASSET.search(parts.path) and not parts.path.lower().endswith(".pdf")) or _SKIP_PATH.search(url):
            continue
        label = re.sub(r"\s+", " ", html_lib.unescape(_TAG.sub(" ", inner))).strip()
        if not same_site(url, root):
            if _OFFSITE_NOT_USEFUL.search(url) or not _MENU_WORDS.search(f"{label} {url}"):
                continue
        found.setdefault(url, label)
    return list(found.items())


def link_priority(url: str, label: str, *, start_path: str = "", name_words: List[str] = ()) -> int:
    """How promising a link is for a concierge: the restaurant's own section and name, menus (PDFs above
    all) and booking/house pages first; blog posts and news last. Only orders the crawl, never filters it."""
    path = urlsplit(url).path
    text = f"{label} {path}"
    score = 0
    if start_path and path.startswith(start_path):
        score += 3
    if name_words and all(w in _words(text) for w in name_words):
        score += 3
    if _USEFUL_WORDS.search(text):
        score += 2
    if path.lower().endswith(".pdf"):
        score += 2
    if _NOISE_PATH.search(path):
        score -= 3
    return score


def sitemap_locations(raw: bytes) -> List[str]:
    """Every <loc> of a sitemap (child sitemaps included, ending in .xml)."""
    return _LOC.findall(raw.decode("utf-8", "ignore"))


def page_title(raw: bytes) -> str:
    match = _TITLE.search(raw[:200_000].decode("utf-8", "ignore"))
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG.sub(" ", match.group(1)))).strip()[:200] if match else ""


@dataclass(frozen=True)
class MenuLink:
    url: str
    covers: str  # full | wine | drinks | lunch | dessert | tasting
    is_pdf: bool


def _covers(text: str) -> str:
    for name, pattern in _COVERS:
        if pattern.search(text):
            return name
    return "full"


def discover_menu_links(raw: bytes, base_url: str) -> List[MenuLink]:
    """Every link on the page that looks like a menu document, absolute and deduplicated, PDFs first."""
    page = raw.decode("utf-8", "ignore")
    seen: set[str] = set()
    links: List[MenuLink] = []
    for href, inner in _ANCHOR.findall(page):
        href = html_lib.unescape(href.strip())
        if href.lower().startswith(("mailto:", "tel:", "javascript:", "whatsapp:")):
            continue
        url = urljoin(base_url, href)
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or any(host in parts.netloc for host in _NOT_MENU_HOSTS):
            continue
        if "." not in parts.netloc or re.search(r"https?[:/]", parts.netloc + parts.path[:12]):
            continue  # broken links seen on real sites, e.g. "https://mhttps://menu.example/..."
        label = html_lib.unescape(_TAG.sub(" ", inner))
        path = parts.path.lower()
        is_pdf = path.endswith(".pdf")
        if not (is_pdf or _MENU_WORDS.search(label) or _MENU_WORDS.search(path)):
            continue
        if re.search(r"reserv", label + " " + path, re.I) and not is_pdf:
            continue
        key = url.split("#")[0]
        if key in seen:
            continue
        seen.add(key)
        links.append(MenuLink(url=key, covers=_covers(f"{label} {path}"), is_pdf=is_pdf))
    return sorted(links, key=lambda link: (not link.is_pdf,))


# Words that do not identify a restaurant's name ...
_STOPWORDS = {
    "restaurante",
    "restaurant",
    "ristorante",
    "bar",
    "the",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "a",
    "o",
    "la",
    "le",
    "il",
    "sao",
    "paulo",
    "sp",
    "rua",
    "r",
    "av",
    "avenida",
    "alameda",
    "al",
}
# ... and words of an address that do not tell one place from another (the city DOES: "São Paulo" picks
# "Fasano São Paulo" over "Fasano Angra dos Reis").
_ADDRESS_STOP = {
    "rua",
    "av",
    "avenida",
    "alameda",
    "travessa",
    "praca",
    "brasil",
    "brazil",
    "sp",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "the",
}


def _words(text: str) -> list:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", plain)


def discover_named_pages(raw: bytes, base_url: str, name: str, address: str) -> List[str]:
    """On a group's site (one site, many restaurants and units), the page of THIS restaurant.

    A link qualifies only when its label or path carries every word of the name as a whole word
    ("Gero" matches "Gero Jardins", not "Leggero"); among those, the ones whose words also appear in the
    entity's address win ("Jardins" in the address -> "Gero Jardins", not "Gero Rio"). Only the best
    scoring pages are returned, so other units are not visited.
    """
    wanted = [w for w in _words(name) if w not in _STOPWORDS and len(w) >= 2]
    if not wanted:
        return []
    place = {w for w in _words(address) if w not in _ADDRESS_STOP and len(w) >= 3 and not w.isdigit()}
    page = raw.decode("utf-8", "ignore")
    scored: dict = {}
    for href, inner in _ANCHOR.findall(page):
        url = urljoin(base_url, html_lib.unescape(href.strip())).split("#")[0]
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or parts.netloc != urlsplit(base_url).netloc:
            continue
        words = set(_words(html_lib.unescape(_TAG.sub(" ", inner)) + " " + parts.path))
        if not all(w in words for w in wanted):
            continue
        score = len(place & words)
        scored[url] = max(score, scored.get(url, -1))
    if not scored:
        return []
    best = max(scored.values())
    return [url for url, score in scored.items() if score == best]


def classify_kind(url: str, content_type: str) -> str:
    """pdf | platform | image | html, from what the server said and where the document lives."""
    ctype = (content_type or "").lower()
    host = urlsplit(url).netloc.lower()
    if "pdf" in ctype or urlsplit(url).path.lower().endswith(".pdf"):
        return "pdf"
    if any(platform in host or platform in url.lower() for platform in MENU_PLATFORMS):
        return "platform"
    if ctype.startswith("image/"):
        return "image"
    return "html"


def count_prices(text: str) -> int:
    return len(_PRICE.findall(text or ""))


def html_to_text(raw: bytes) -> str:
    """Visible text of a page, one block per line; scripts, styles and markup removed."""
    page = raw.decode("utf-8", "ignore")
    page = _CODE.sub(" ", page)
    page = _BREAKS.sub("\n", page)
    text = html_lib.unescape(_TAG.sub(" ", page))
    lines = (re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def pdf_to_pages(raw: bytes) -> List[str]:
    """Text of each page (up to MAX_PDF_PAGES); an unreadable PDF is an empty list, never an error."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        pages = []
        for page in reader.pages[:MAX_PDF_PAGES]:
            pages.append((page.extract_text(extraction_mode="layout") or "").strip())
        return [page for page in pages if page]
    except Exception as exc:  # noqa: BLE001 - a broken PDF is "nothing to read"
        logger.info("[Menu] PDF unreadable: %s", type(exc).__name__)
        return []
