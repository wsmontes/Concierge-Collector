"""
fakes.py — fakes em memória de client/banco/coleção pymongo para os testes
dos scripts de python-tools (não há mongod local; a superfície usada é pequena).
Uso exclusivo em testes — nunca importar de código de produção.
"""
from types import SimpleNamespace


class FakeClient:
    """Fake de pymongo.MongoClient — expõe address (identidade do cluster)."""

    address = ("cluster0-shard-00-00.7bwiisy.mongodb.net", 27017)


def _match(doc, query):
    """Subconjunto do MQL suficiente para os filtros reais dos scripts:
    $or, $exists, $ne, $eq e igualdade escalar (ex.: {'embeddings': []})."""
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        if isinstance(cond, dict):
            if "$exists" in cond and (key in doc) != bool(cond["$exists"]):
                return False
            if "$ne" in cond and doc.get(key) == cond["$ne"]:
                return False
            if "$eq" in cond and doc.get(key) != cond["$eq"]:
                return False
            if all(k not in cond for k in ("$exists", "$ne", "$eq")):
                if not _match(doc.get(key) or {}, cond):
                    return False
            continue
        if doc.get(key) != cond:
            return False
    return True


class FakeCollection:
    """Fake de pymongo.collection.Collection com a superfície usada pelos scripts."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.dropped = False
        self.inserted_count = 0
        self.insert_sizes = []
        self.find_kwargs = None
        self.find_one_side_effect = None
        self.count_error = None
        self.created_indexes = []
        self.fail_index_keys = set()
        self.last_update_filter = None
        self.update_matched = 0

    def count_documents(self, query):
        if self.count_error is not None:
            raise self.count_error
        return sum(1 for d in self.docs if _match(d, query))

    def find_one(self, query=None, projection=None, sort=None):
        if self.find_one_side_effect is not None:
            self.find_one_side_effect()
        matches = [d for d in self.docs if _match(d, query or {})]
        if sort:
            key, direction = sort[0]
            matches = sorted(
                matches,
                key=lambda d: (d.get(key) is not None, d.get(key) or ""),
                reverse=(direction == -1),
            )
        return matches[0] if matches else None

    def drop(self):
        self.dropped = True
        self.docs = []

    def insert_many(self, docs):
        docs = list(docs)
        self.inserted_count += len(docs)
        self.insert_sizes.append(len(docs))
        self.docs.extend(docs)

    def find(self, query, **kwargs):
        self.find_kwargs = kwargs
        return iter([d for d in self.docs if _match(d, query)])

    def create_index(self, keys, **kwargs):
        spec_key = (
            tuple(keys) if isinstance(keys, list) else keys,
            kwargs.get("unique"),
            kwargs.get("sparse"),
            kwargs.get("expireAfterSeconds"),
        )
        if spec_key in self.fail_index_keys:
            raise Exception("E11000 duplicate key error collection (simulado)")
        self.created_indexes.append((keys, kwargs))
        return "ok"

    def update_one(self, filtro, update, **kwargs):
        self.last_update_filter = filtro
        matched = [d for d in self.docs if _match(d, filtro)]
        for d in matched:
            d.update(update.get("$set", {}))
        self.update_matched = len(matched)
        return SimpleNamespace(matched_count=self.update_matched)


class FakeDB:
    """Fake de pymongo.database.Database — coleções acessíveis por atributo/index."""

    name = "concierge-collector"

    def __init__(self, colls=None):
        self.colls = dict(colls or {})
        self.second_call_extra = None
        self.extra_on_call = 2

    def __getattr__(self, name):
        if name in self.colls:
            return self.colls[name]
        raise AttributeError(name)

    def __getitem__(self, name):
        # como no pymongo real: coleção inexistente responde 0 docs, não KeyError
        return self.colls.get(name, FakeCollection())

    def list_collection_names(self):
        names = list(self.colls)
        self._names_calls = getattr(self, "_names_calls", 0) + 1
        # simula coleção criada por processo concorrente a partir da N-ésima
        # chamada (a 2ª chamada é o SEM DUMP do verify; a 3ª é o re-check do
        # wipe pós-verify)
        if self._names_calls >= self.extra_on_call and self.second_call_extra is not None:
            return names + [self.second_call_extra]
        return names
