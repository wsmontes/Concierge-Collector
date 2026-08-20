import gzip
import hashlib
import json

from app.services.distribution_dump import collect_json_dump, gzip_iter, iter_ndjson_dump


def test_ndjson_has_manifest_items_and_valid_footer():
    chunks = list(
        iter_ndjson_dump(
            {"collection": {"slug": "sushi", "version": 2}},
            [[{"schema_version": 1, "curation": {"id": "c1"}}], [{"schema_version": 1, "curation": {"id": "c2"}}]],
        )
    )
    records = [json.loads(line) for line in b"".join(chunks).splitlines()]
    assert records[0]["record_type"] == "manifest"
    assert records[-1]["record_type"] == "footer"
    item_lines = [line + b"\n" for line in b"".join(chunks).splitlines() if b'"record_type":"item"' in line]
    assert records[-1]["available_count"] == 2
    assert records[-1]["sha256"] == hashlib.sha256(b"".join(item_lines)).hexdigest()


def test_collect_json_dump_groups_manifest_items_and_footer():
    document = collect_json_dump(
        {"collection": {"slug": "sushi", "version": 2}},
        [[{"schema_version": 1, "curation": {"id": "c1"}}, {"schema_version": 1, "curation": {"id": "c2"}}]],
    )
    assert document["manifest"]["collection"] == {"slug": "sushi", "version": 2}
    assert [item["curation"]["id"] for item in document["items"]] == ["c1", "c2"]
    assert document["footer"]["available_count"] == 2


def test_gzip_dump_preserves_logical_records():
    source = iter_ndjson_dump({"collection": {"slug": "sushi", "version": 2}}, [[{"schema_version": 1}]])
    decoded = gzip.decompress(b"".join(gzip_iter(source)))
    assert [json.loads(line)["record_type"] for line in decoded.splitlines()] == ["manifest", "item", "footer"]
