"""
File: test_menu_reading.py
Purpose: finding a restaurant's menu documents on its site and reading them as text (no network).
Dependencies: app.services.menu_reading.

A menu is often several documents (food, wine list, drinks, lunch): every one is found, not only the
best. Links that are not menus (reservations, mailto, social) are ignored. PDF and HTML become plain
text; price counting tells a priced menu from a page that only talks about the food.
"""

from app.services import menu_reading as reading

SITE = "https://restaurante.com.br/"

HOME = """
<html><head><title>Restaurante</title><script>var x = "R$ 99,00";</script><style>.a{}</style></head>
<body>
<nav>
  <a href="/sobre">Sobre</a>
  <a href="/cardapio/">Card&aacute;pio</a>
  <a href="https://restaurante.com.br/wp/uploads/Carta-de-Vinhos.pdf">Carta de vinhos</a>
  <a href="/drinks">Drinks</a>
  <a href="/reservas">Reservas</a>
  <a href="mailto:contato@restaurante.com.br">Menu de contato</a>
  <a href="https://instagram.com/restaurante">Instagram</a>
  <a href="/cardapio/">Cardápio de novo</a>
</nav>
<a href="/files/almoco-executivo.pdf">almoço</a>
</body></html>
""".encode()


def test_every_menu_document_is_found_once_and_absolute():
    found = reading.discover_menu_links(HOME, SITE)

    urls = [c.url for c in found]
    assert urls[0].endswith(".pdf")  # PDFs first: they are the menu itself
    assert set(urls) == {
        "https://restaurante.com.br/cardapio/",
        "https://restaurante.com.br/wp/uploads/Carta-de-Vinhos.pdf",
        "https://restaurante.com.br/drinks",
        "https://restaurante.com.br/files/almoco-executivo.pdf",
    }


def test_what_each_document_covers_comes_from_its_link():
    covers = {
        c.url.rsplit("/", 1)[-1] or c.url.rsplit("/", 2)[-2]: c.covers for c in reading.discover_menu_links(HOME, SITE)
    }

    assert covers["Carta-de-Vinhos.pdf"] == "wine"
    assert covers["drinks"] == "drinks"
    assert covers["almoco-executivo.pdf"] == "lunch"
    assert covers["cardapio"] == "full"


def test_links_that_are_not_menus_are_ignored():
    html = b'<a href="/reservas">Reservar</a><a href="tel:+5511">Menu</a><a href="javascript:void(0)">Menu</a>'

    assert reading.discover_menu_links(html, SITE) == []


def test_kind_comes_from_content_type_extension_or_platform():
    assert reading.classify_kind("https://x.com/a.pdf?v=2", "application/octet-stream") == "pdf"
    assert reading.classify_kind("https://x.com/menu", "application/pdf") == "pdf"
    assert reading.classify_kind("https://app.goomer.app/loja/123", "text/html") == "platform"
    assert reading.classify_kind("https://x.com/menu.jpg", "image/jpeg") == "image"
    assert reading.classify_kind("https://x.com/cardapio", "text/html; charset=utf-8") == "html"


def test_prices_are_counted_in_the_forms_menus_use():
    text = "Fettuccine ao ragu 260,00\nCouvert R$ 36\nDegustação Picchi 1249,00\nTel (11) 3065-5560\n2026"

    assert reading.count_prices(text) == 3


def test_html_text_keeps_the_words_and_drops_code():
    text = reading.html_to_text(HOME)

    assert "Carta de vinhos" in text and "Cardápio" in text
    assert "var x" not in text and ".a{}" not in text


def _pdf_with_text(lines: list[str]) -> bytes:
    """A minimal valid one-page PDF whose content stream draws the given lines."""
    stream = "BT /F1 12 Tf 72 720 Td " + " ".join(f"({line}) Tj 0 -16 Td" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> "
        "/Contents 4 0 R >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def test_pdf_text_is_read_page_by_page():
    pages = reading.pdf_to_pages(_pdf_with_text(["Fettuccine ao ragu 260,00", "Tiramisu 58,00"]))

    assert len(pages) == 1
    assert "Fettuccine ao ragu 260,00" in pages[0] and "Tiramisu 58,00" in pages[0]


def test_a_broken_pdf_reads_as_nothing_instead_of_failing():
    assert reading.pdf_to_pages(b"%PDF-1.4 not really") == []


GROUP = b"""
<a href="/gastronomia/gero-rio/">Gero Rio</a>
<a href="/gastronomia/gero-itaim/">Gero Itaim</a>
<a href="/gastronomia/gero-jardins/">Gero Jardins</a>
<a href="/gastronomia/gero-panini/">Gero Panini Itaim</a>
<a href="/gastronomia/leggero/">Leggero</a>
<a href="/hoteis/fasano-sp/">Hotel Fasano</a>
"""


def test_on_a_group_site_the_page_of_this_unit_is_found_by_name_and_address():
    pages = reading.discover_named_pages(
        GROUP, "https://fasano.com.br/", "Gero", "R. Haddock Lobo, 1629 - Jardins, São Paulo"
    )

    assert pages[0] == "https://fasano.com.br/gastronomia/gero-jardins/"
    assert "https://fasano.com.br/gastronomia/leggero/" not in pages  # "leggero" contains "gero", not the name


def test_a_page_must_carry_every_word_of_the_name():
    pages = reading.discover_named_pages(GROUP, "https://fasano.com.br/", "Gero Panini", "Itaim Bibi")

    assert pages == ["https://fasano.com.br/gastronomia/gero-panini/"]


def test_the_city_in_the_address_picks_the_unit_in_that_city():
    group = b"""<a href="/g/fasano-angra-dos-reis/">Fasano Angra dos Reis</a>
    <a href="/g/fasano-jardins/">Fasano S\xc3\xa3o Paulo</a>
    <a href="/g/fasano-new-york/">Fasano Restaurant New York</a>"""

    pages = reading.discover_named_pages(
        group, "https://fasano.com.br/", "Fasano", "R. Vitório Fasano, 88 - Cerqueira César, São Paulo - SP"
    )

    assert pages == ["https://fasano.com.br/g/fasano-jardins/"]


def test_a_delivery_menu_is_marked_as_such():
    links = reading.discover_menu_links(b'<a href="/cardapio-delivery">Card\xc3\xa1pio delivery</a>', "https://x.com/")

    assert links[0].covers == "delivery"


def test_site_links_follow_the_site_and_menu_platforms_but_not_assets_or_social_networks():
    page = (
        b'<a href="/reservas">Reservas</a><a href="https://www.casa.example/eventos">Eventos</a>'
        b'<a href="/logo.png">x</a><a href="/carrinho/">Carrinho</a><a href="https://instagram.com/casa">IG</a>'
        b'<a href="https://meemo.menu/casa">Card\xc3\xa1pio</a><a href="https://outro.example/blog">Blog</a>'
    )

    links = dict(reading.site_links(page, "https://casa.example/"))

    assert set(links) == {
        "https://casa.example/reservas",
        "https://www.casa.example/eventos",
        "https://meemo.menu/casa",
    }


def test_link_priority_puts_this_unit_and_menus_before_news():
    unit = reading.link_priority("https://g.example/gero/cardapio.pdf", "", start_path="/gero", name_words=["gero"])
    booking = reading.link_priority("https://g.example/reservas", "Reservas")
    news = reading.link_priority("https://g.example/blog/2026/05/inauguracao", "Inauguração")

    assert unit > booking > news


def test_sitemap_locations_and_page_title():
    assert reading.sitemap_locations(b"<urlset><url><loc> https://c.example/a </loc></url></urlset>") == [
        "https://c.example/a"
    ]
    assert reading.page_title(b"<html><title>Casa &amp; Cia\n | Card\xc3\xa1pio</title>") == "Casa & Cia | Cardápio"
