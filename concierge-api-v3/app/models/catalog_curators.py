"""Directory contract of the CMS curator picker.

A Curation identifies its owner by an opaque ``curator_id`` (the curator's
email) plus a denormalized ``curator.name``/``curator.email``. Until now the
Admin could only display that identity, because no route listed the directory
the login flow maintains; this payload is exactly what a picker needs to choose
one: the identity it writes back and the two values it renders, nothing else
(no picture, no provider data).
"""

from pydantic import BaseModel

# Bounds published so the Admin and the route agree on the page the directory
# serves instead of discovering the ceiling through a rejection.
CURATOR_SEARCH_DEFAULT_LIMIT = 20
CURATOR_SEARCH_MAX_LIMIT = 50


class CuratorRow(BaseModel):
    """One curator of the directory: the identity a ``curator_id`` write carries."""

    curator_id: str
    name: str | None = None
    email: str | None = None


class CuratorListPage(BaseModel):
    """One bounded page of the curator directory, ordered by name.

    The directory is always searched and never dumped: ``limit`` bounds the
    page, and there is no keyset behind it — a curator search is a short list,
    not a scrollable catalog — so ``next_cursor`` is always null.
    """

    items: list[CuratorRow]
    next_cursor: str | None = None
