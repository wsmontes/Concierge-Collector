"""
conftest.py — testes dos scripts de scripts/python-tools.
Torna os módulos do diretório pai importáveis (os scripts não são um pacote)
e a raiz da API (para app/core/vector_packing.py, compartilhado).
Rode com: concierge-api-v3/.venv/bin/pytest scripts/python-tools/tests/
"""
import os
import sys

SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_ROOT = os.path.join(os.path.dirname(SCRIPTS_DIR), "concierge-api-v3")
sys.path.insert(0, SCRIPTS_DIR)
sys.path.insert(0, API_ROOT)
