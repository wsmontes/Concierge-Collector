import pytest

from scripts.seed_e2e_curations import validate_test_database_name


def test_e2e_seed_accepts_only_explicit_test_database_names():
    assert validate_test_database_name("concierge-collector-test") == "concierge-collector-test"
    assert validate_test_database_name("concierge-collector-e2e-test") == "concierge-collector-e2e-test"

    with pytest.raises(RuntimeError, match="must end with '-test'"):
        validate_test_database_name("concierge-collector")

    with pytest.raises(RuntimeError, match="must end with '-test'"):
        validate_test_database_name("")
