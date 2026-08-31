"""Semantic-truth regression tests for local curation pipelines."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "scripts" / "python-tools"


def _load(name: str, filename: str):
    spec = spec_from_file_location(name, TOOLS / filename)
    module = module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_research_vocabulary_uses_explicit_curator_type_before_legacy_id_markers():
    research = _load("semantic_research_curations", "research_curations.py")
    curations = [
        {
            "curator_id": "alice-research@example.com",
            "curator_type": "human",
            "categories": {"cuisine": ["human-explicit"]},
        },
        {
            "curator_id": "totally-human-looking@example.com",
            "curator_type": "synthetic",
            "categories": {"cuisine": ["synthetic-explicit"]},
        },
        {
            # Legacy record: no curator_type, so marker fallback remains valid.
            "curator_id": "curator-ai-research",
            "categories": {"cuisine": ["legacy-automation"]},
        },
        {
            "curator_id": "legacy-human@example.com",
            "categories": {"cuisine": ["legacy-human"]},
        },
    ]

    vocab = research.build_vocabulary(curations)

    assert "human-explicit" in vocab["cuisine"]
    assert "legacy-human" in vocab["cuisine"]
    assert "synthetic-explicit" not in vocab["cuisine"]
    assert "legacy-automation" not in vocab["cuisine"]


def test_json_import_preserves_explicit_curator_type_and_never_derives_it_from_curator_id():
    importer = _load("semantic_import_curations", "import_curations.py")
    raw = {
        "curation_id": "cur-explicit-human",
        "curator_id": "curator-ai-research",
        "curator": {"id": "curator-ai-research", "name": "Human Researcher"},
        "curator_type": "human",
        "restaurant_name": "Test Place",
        "categories": {"cuisine": ["italian"]},
    }

    normalized = importer.normalize_curation(
        raw,
        default_curator_id="curator-import-default",
        default_curator_type="synthetic",
    )
    assert normalized["curator_type"] == "human"

    custom_automation = {
        "curation_id": "cur-custom-bot",
        "curator_id": "bot-with-human-looking-id@example.com",
        "curator": {"id": "bot-with-human-looking-id@example.com", "name": "Automation"},
        "restaurant_name": "Another Place",
        "categories": {"cuisine": ["thai"]},
    }
    normalized_bot = importer.normalize_curation(
        custom_automation,
        default_curator_id="curator-import-default",
        default_curator_type="synthetic",
    )
    assert normalized_bot["curator_type"] == "synthetic"


def test_excel_import_requires_explicit_pipeline_curator_type_not_id_shape():
    excel = _load("semantic_import_curations_excel", "import_curations_from_excel.py")

    curation = excel.build_curation_document(
        Path("knowledge.xlsx"),
        "Sheet Place",
        {"cuisine": ["japanese"]},
        "human-looking-bot@example.com",
        "Automation Account",
        curator_type="synthetic",
    )
    assert curation["curator_type"] == "synthetic"

    human = excel.build_curation_document(
        Path("knowledge.xlsx"),
        "Human Sheet",
        {"cuisine": ["french"]},
        "curator-import-excel",
        "Actual Human",
        curator_type="human",
    )
    assert human["curator_type"] == "human"
