"""
Testes dos filtros de entities e dos campos city/type na serialização de
curadorias. Sem MongoDB — db fake com a superfície mínima usada pelas rotas.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.api.entities import list_entities
from app.models.schemas import Curation


class FindChain:
    """Cadeia find().sort().skip().limit() retornando docs reais."""

    def __init__(self, docs):
        self.docs = docs
        self.last_query = None
        self.find_one_docs = []  # docs retornados por find_one (cursor resolve_after_id)

    def find(self, query, **kwargs):
        self.last_query = query
        return self

    def find_one(self, query, projection=None):
        return self.find_one_docs[0] if self.find_one_docs else None

    def count_documents(self, query):
        self.last_query = query
        return len(self.docs)

    def sort(self, *args, **kwargs):
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __iter__(self):
        return iter(self.docs)


def _entity_doc(id_, status="active"):
    return {
        "_id": id_, "entity_id": id_, "name": f"Rest {id_}", "type": "restaurant",
        "status": status, "updatedAt": datetime.now(timezone.utc),
        "createdAt": datetime.now(timezone.utc), "version": 1,
    }


def test_list_entities_filters_by_status():
    docs = [_entity_doc("a", "active"), _entity_doc("b", "inactive")]
    chain = FindChain(list(docs))
    db = MagicMock()
    db.entities = chain

    list_entities(status="active", type=None, name=None, since=None,
                  limit=50, offset=0, after_id=None, db=db)
    assert chain.last_query == {"status": "active"}


def test_list_entities_without_status_keeps_old_behavior():
    docs = [_entity_doc("a")]
    chain = FindChain(list(docs))
    db = MagicMock()
    db.entities = chain

    list_entities(status=None, type=None, name=None, since=None,
                  limit=50, offset=0, after_id=None, db=db)
    assert chain.last_query == {}


def _db_with_chain(docs, find_one_docs=None):
    """MagicMock cujo db['entities'] (item access usado por resolve_after_id)
    E db.entities (atributo) apontam para a MESMA cadeia fake."""
    chain = FindChain(list(docs))
    chain.find_one_docs = find_one_docs or []
    db = MagicMock()
    db.entities = chain
    db.__getitem__ = lambda self, k: chain
    return db, chain


def test_list_entities_after_id_hex_converts_to_objectid_when_doc_exists():
    """Cursor contra string NUNCA visita _ids ObjectId (ordenação por tipo) —
    o hex vira ObjectId SÓ se um doc com esse ObjectId existe na coleção."""
    from bson import ObjectId

    hex_id = "0" * 24
    db, chain = _db_with_chain([_entity_doc("a")], [{"_id": ObjectId(hex_id)}])
    list_entities(status=None, type=None, name=None, since=None,
                  limit=50, offset=0, after_id=hex_id, db=db)
    assert chain.last_query["_id"] == {"$gt": ObjectId(hex_id)}


def test_list_entities_after_id_hex_string_keeps_string_when_no_objectid_doc():
    """String 24-hex legítima (sem doc ObjectId correspondente) NÃO é
    convertida — converter truncaria o walk das strings."""
    hex_id = "a" * 24
    db, chain = _db_with_chain([_entity_doc("a")])  # nenhum ObjectId existe
    list_entities(status=None, type=None, name=None, since=None,
                  limit=50, offset=0, after_id=hex_id, db=db)
    assert chain.last_query["_id"] == {"$gt": hex_id}


def test_list_entities_after_id_non_hex_keeps_string():
    db, chain = _db_with_chain([_entity_doc("a")])
    list_entities(status=None, type=None, name=None, since=None,
                  limit=50, offset=0, after_id="rest_komah", db=db)
    assert chain.last_query["_id"] == {"$gt": "rest_komah"}


def test_list_entities_escapes_name_regex():
    """name='(' não pode chegar cru ao Mongo (regex inválida → 500)."""
    db, chain = _db_with_chain([_entity_doc("a")])
    list_entities(status=None, type=None, name="(", since=None,
                  limit=50, offset=0, after_id=None, db=db)
    assert chain.last_query["name"] == {"$regex": "\\(", "$options": "i"}


def test_curation_serializes_city_and_type():
    """Os filtros do UI liam c.type/c.city, mas o modelo descartava os campos
    na serialização — o dropdown nunca populava."""
    curation = Curation(
        id="c1", curation_id="c1", curator={"id": "u1", "name": "T", "email": None},
        status="active", city="São Paulo", type="restaurant",
        createdAt=datetime.now(timezone.utc), updatedAt=datetime.now(timezone.utc),
    )
    dumped = curation.model_dump(by_alias=True)
    assert dumped["city"] == "São Paulo"
    assert dumped["type"] == "restaurant"
