"""
Testes dos filtros de entities e dos campos city/type na serialização de
curadorias. Sem MongoDB — db fake com a superfície mínima usada pelas rotas.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.api.entities import list_entities
from app.models.schemas import Curation


class FindChain:
    """Cadeia find().sort().skip().limit() com o BRACKETING DE TIPO do Mongo:
    $gt contra string só casa _ids string; contra ObjectId só ObjectId. É o
    comportamento que torna a transição de segmento necessária e testável."""

    def __init__(self, docs):
        self.docs = docs
        self._found = docs
        self.last_query = None
        self.last_find_one_query = None
        self.queries = []  # histórico de find() — transição é verificável
        self.find_one_docs = (
            []
        )  # docs retornados por find_one (cursor resolve_after_id)

    def find(self, query, **kwargs):
        self.last_query = query
        self.queries.append(query)
        cond = (query or {}).get("_id", {}).get("$gt")
        if cond is not None:
            # type bracketing: só casa o MESMO tipo BSON do cursor
            self._found = [
                d
                for d in self.docs
                if d.get("_id") is not None
                and type(d["_id"]) is type(cond)
                and d["_id"] > cond
            ]
        else:
            self._found = list(self.docs)
        return self

    def find_one(self, query, projection=None):
        self.last_find_one_query = query
        wanted = query.get("_id")
        for d in self.find_one_docs:
            if d.get("_id") == wanted:
                return d
        return None

    def count_documents(self, query):
        self.last_query = query
        return len(self.docs)

    def sort(self, *args, **kwargs):
        return self

    def skip(self, n):
        self._found = self._found[n:]
        return self

    def limit(self, n):
        self._found = self._found[:n]
        return self

    def __iter__(self):
        return iter(self._found)


def _entity_doc(id_, status="active"):
    return {
        "_id": id_,
        "entity_id": id_,
        "name": f"Rest {id_}",
        "type": "restaurant",
        "status": status,
        "updatedAt": datetime.now(timezone.utc),
        "createdAt": datetime.now(timezone.utc),
        "version": 1,
    }


def test_list_entities_filters_by_status():
    docs = [_entity_doc("a", "active"), _entity_doc("b", "inactive")]
    chain = FindChain(list(docs))
    db = MagicMock()
    db.entities = chain

    list_entities(
        status="active",
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id=None,
        db=db,
    )
    assert chain.last_query == {"status": "active"}


def test_list_entities_without_status_keeps_old_behavior():
    docs = [_entity_doc("a")]
    chain = FindChain(list(docs))
    db = MagicMock()
    db.entities = chain

    list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id=None,
        db=db,
    )
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
    list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id=hex_id,
        db=db,
    )
    assert chain.last_query["_id"] == {"$gt": ObjectId(hex_id)}


def test_list_entities_after_id_hex_string_keeps_string_when_no_objectid_doc():
    """String 24-hex legítima (sem doc ObjectId correspondente) NÃO é
    convertida — converter truncaria o walk das strings."""
    hex_id = "a" * 24
    # doc string DEPOIS do cursor (sem transição) e nenhum ObjectId no probe
    db, chain = _db_with_chain([_entity_doc("zzzz")])
    list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id=hex_id,
        db=db,
    )
    assert len(chain.queries) == 1  # sem transição: ainda havia strings
    assert chain.last_query["_id"] == {"$gt": hex_id}
    # o probe consultou o ObjectId e não achou — cursor ficou string
    from bson import ObjectId

    assert chain.last_find_one_query == {"_id": ObjectId(hex_id)}


def test_list_entities_after_id_non_hex_keeps_string():
    db, chain = _db_with_chain([_entity_doc("rest_zzz")])
    list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id="rest_komah",
        db=db,
    )
    assert len(chain.queries) == 1  # havia strings depois do cursor
    assert chain.last_query["_id"] == {"$gt": "rest_komah"}


def test_list_entities_escapes_name_regex():
    """name='(' não pode chegar cru ao Mongo (regex inválida → 500)."""
    db, chain = _db_with_chain([_entity_doc("a")])
    list_entities(
        status=None,
        type=None,
        name="(",
        since=None,
        limit=50,
        offset=0,
        after_id=None,
        db=db,
    )
    assert chain.last_query["name"] == {"$regex": "\\(", "$options": "i"}


def test_list_entities_string_cursor_transitions_to_objectid_segment():
    """O segmento de strings termina em página vazia — a transição entra no
    segmento ObjectId (471 entities reais ficavam invisíveis)."""
    from bson import ObjectId

    oid_doc = _entity_doc(str(ObjectId("ab" * 12)))
    oid_doc["_id"] = ObjectId("ab" * 12)
    db, chain = _db_with_chain([_entity_doc("rest_b"), oid_doc])

    resp = list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id="zzzz",
        db=db,
    )
    # 1ª query: $gt 'zzzz' → vazio (strings); 2ª: transição $gt ObjectId(0)
    assert len(chain.queries) == 2
    assert isinstance(chain.queries[1]["_id"]["$gt"], ObjectId)
    ids = [i.id for i in resp.items]
    assert ids == [str(ObjectId("ab" * 12))]


def test_list_entities_string_cursor_with_more_strings_does_not_transition():
    """Ainda há strings depois do cursor: NÃO transiciona (a transição só
    dispara com página vazia)."""
    db, chain = _db_with_chain([_entity_doc("rest_b")])

    resp = list_entities(
        status=None,
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id="rest_a",
        db=db,
    )
    assert len(chain.queries) == 1
    assert [i.id for i in resp.items] == ["rest_b"]


def test_transition_preserves_other_filters():
    """A query de transição carrega TODOS os filtros (status/since) — só o
    _id muda; puxar docs deletados/fora do since no cursor mode seria puxar
    lixo."""
    from bson import ObjectId

    oid_doc = _entity_doc(str(ObjectId("ab" * 12)))
    oid_doc["_id"] = ObjectId("ab" * 12)
    db, chain = _db_with_chain([oid_doc])

    list_entities(
        status="active",
        type=None,
        name=None,
        since=None,
        limit=50,
        offset=0,
        after_id="zzzz",
        db=db,
    )
    assert len(chain.queries) == 2
    assert chain.queries[1]["status"] == "active"
    assert isinstance(chain.queries[1]["_id"]["$gt"], ObjectId)


def test_curation_id_coercion_rejects_none():
    """_id None não pode virar a string 'None' (id de lixo na resposta)."""
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Curation(
            id=None,
            curation_id="c1",
            curator={"id": "u1", "name": "T", "email": None},
            status="active",
        )


def test_curation_serializes_city_and_type():
    """Os filtros do UI liam c.type/c.city, mas o modelo descartava os campos
    na serialização — o dropdown nunca populava."""
    curation = Curation(
        id="c1",
        curation_id="c1",
        curator={"id": "u1", "name": "T", "email": None},
        status="active",
        city="São Paulo",
        type="restaurant",
        createdAt=datetime.now(timezone.utc),
        updatedAt=datetime.now(timezone.utc),
    )
    dumped = curation.model_dump(by_alias=True)
    assert dumped["city"] == "São Paulo"
    assert dumped["type"] == "restaurant"
