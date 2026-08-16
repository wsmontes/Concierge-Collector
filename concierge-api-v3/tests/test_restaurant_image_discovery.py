"""
Tests for restaurant website image discovery with source provenance.
"""

from app.services.restaurant_image_discovery import discover_image_urls


def test_discovery_preserves_priority_and_source_provenance():
    raw = (
        b'<meta property="og:image" content="https://site.com/hero.jpg">'
        b'<meta name="twitter:image" content="https://site.com/twitter.jpg">'
        b'<img src="https://site.com/body.jpg">'
    )
    found = discover_image_urls(raw, "https://site.com/restaurant")
    assert [str(item) for item in found] == [
        "https://site.com/hero.jpg",
        "https://site.com/twitter.jpg",
        "https://site.com/body.jpg",
    ]
    assert [item.source for item in found] == ["website_og", "website_twitter", "website_img"]


def test_discovery_uses_largest_srcset_candidate():
    raw = b'<img src="/small.jpg" srcset="/small.jpg 320w, /medium.jpg 800w, /large.jpg 1600w">'
    found = discover_image_urls(raw, "https://site.com/menu")
    assert str(found[0]) == "https://site.com/large.jpg"
    assert found[0].source == "website_img"


def test_discovery_supports_picture_source_srcset():
    raw = (
        b'<picture><source srcset="/hero-800.webp 800w, /hero-1600.webp 1600w" type="image/webp">'
        b'<img src="/hero.jpg"></picture>'
    )
    found = discover_image_urls(raw, "https://site.com/")
    assert str(found[0]) == "https://site.com/hero-1600.webp"


def test_discovery_respects_base_href_jsonld_and_filters_decorative_images():
    raw = (
        b'<base href="https://cdn.site.com/assets/">'
        b'<script type="application/ld+json">{"image":"food/main.jpg"}</script>'
        b'<img src="site-logo.png">'
        b'<img src="food/second.jpg">'
    )
    found = discover_image_urls(raw, "https://site.com/page")
    assert [str(item) for item in found] == [
        "https://cdn.site.com/assets/food/main.jpg",
        "https://cdn.site.com/assets/food/second.jpg",
    ]
    assert found[0].source == "website_jsonld"
