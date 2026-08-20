import pytest

from app.core.cms_database import CmsReadOnlyDatabase


class FakeCollection:
    def __init__(self):
        self.calls = []

    def find_one(self, *args, **kwargs):
        self.calls.append(("find_one", args, kwargs))
        return {"ok": True}

    def find(self, *args, **kwargs):
        self.calls.append(("find", args, kwargs))
        return iter([])

    def aggregate(self, pipeline, **kwargs):
        self.calls.append(("aggregate", pipeline, kwargs))
        return iter([])


class FakeDatabase:
    def __init__(self):
        self.collection = FakeCollection()

    def __getitem__(self, _name):
        return self.collection


def test_cms_facade_exposes_only_read_methods_and_blocks_write_stages():
    db = CmsReadOnlyDatabase(FakeDatabase())
    credentials = db.collection("consumer_credentials")
    assert credentials.find_one({"prefix": "a"}) == {"ok": True}
    assert not hasattr(credentials, "insert_one")
    assert not hasattr(credentials, "update_one")
    with pytest.raises(ValueError):
        credentials.aggregate([{"$out": "forbidden"}])
    with pytest.raises(ValueError):
        db.collection("audit_events")
