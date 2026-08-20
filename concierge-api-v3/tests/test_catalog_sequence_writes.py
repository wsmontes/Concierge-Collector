"""
Fronteiras de escrita do catalog_sequence (plano 04, Task 1): reservas
disjuntas e monotônicas, alta água de backfill respeitada e atribuição
server-side em TODOS os writers (create/bulk/capture) com spoof do cliente
ignorado.

Dependências: fixtures in_memory_db/client/auth_headers de conftest.py e os
helpers seed_curations/write_curation_through de tests/factories.py.
"""

import pytest

from app.services.catalog_service import reserve_catalog_sequences
from tests.factories import seed_curations, write_curation_through


def test_reservations_do_not_overlap(in_memory_db):
    in_memory_db._collections.clear()
    first = list(reserve_catalog_sequences(in_memory_db, 3))
    second = list(reserve_catalog_sequences(in_memory_db, 2))
    assert first == [1, 2, 3]
    assert second == [4, 5]


def test_first_reservation_starts_after_existing_backfilled_max(in_memory_db):
    in_memory_db._collections.clear()
    seed_curations(in_memory_db, [(41, "test_catalog_existing_41")])
    assert list(reserve_catalog_sequences(in_memory_db, 2)) == [42, 43]


@pytest.mark.parametrize("writer", ["create", "bulk", "capture"])
def test_every_writer_assigns_server_sequence(writer, client, auth_headers):
    created = write_curation_through(writer, client, auth_headers)
    assert isinstance(created["catalog_sequence"], int)
    attempted = {**created, "curation_id": f"{writer}-spoof", "catalog_sequence": 1}
    spoofed = write_curation_through(writer, client, auth_headers, attempted)
    assert spoofed["catalog_sequence"] != 1
