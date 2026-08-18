"""
test_filter_rich_entities.py — testes do filtro "rich" entre merge e import.

Cobre a regra de riqueza (coordenadas E score >= min-score), os pesos
por campo (contato + postal_code + address + cuisine), os shapes de
borda (campos faltando, listas vazias, null), a contagem de cobertura e
o main() (dry-run, --output, --sweep, arquivo inexistente, UTF-8) com
tmp_path + capsys. Importação via conftest.py (scripts/python-tools no
sys.path).
"""
import json

import filter_rich_entities as fre


def _entity(**overrides):
    """Entity no shape do merge (EntityCreate): data.location/data.contact.

    Chaves de "data" substituem a seção inteira; passar None remove a
    seção (ex.: data={"contact": None} simula entity sem contato).
    """
    e = {
        "entity_id": "osm_1",
        "name": "Restaurante Teste",
        "data": {
            "location": {
                "coordinates": {"lat": -23.5, "lng": -46.6},
                "postal_code": "01310-100",
                "address": "Av. Paulista, 1000",
            },
            "contact": {
                "phone": "+55 11 9999-9999",
                "website": "https://exemplo.com",
                "email": "oi@exemplo.com",
                "facebook": "https://facebook.com/x",
                "instagram": "https://instagram.com/x",
            },
            "cuisine": ["italian"],
        },
    }
    for key, value in (overrides.pop("data", {})).items():
        if value is None:
            e["data"].pop(key, None)
        else:
            e["data"][key] = value
    e.update(overrides)
    return e


# --- richness_score ----------------------------------------------------------

def test_richness_score_8_pontos_com_tudo_preenchido():
    e = _entity()
    assert fre.richness_score(e) == 8  # 5 contato + postal + address + cuisine


def test_richness_score_soma_cada_campo_uma_vez():
    e = _entity(data={
        "contact": {"phone": "1", "website": "1", "email": "1",
                    "facebook": "1", "instagram": "1"},
        "location": {"postal_code": "x", "address": "y"},
        "cuisine": ["japanese", "pizza"],
    })
    assert fre.richness_score(e) == 8  # cuisine conta 1 mesmo com 2 itens


def test_richness_score_ignora_valores_falsy():
    e = _entity(data={
        "contact": {"phone": "", "website": None, "email": 0, "facebook": [], "instagram": ""},
        "location": {"postal_code": "", "address": None},
        "cuisine": [],
    })
    assert fre.richness_score(e) == 0


def test_richness_score_aguenta_entity_vazia_e_secoes_faltando():
    assert fre.richness_score({}) == 0
    assert fre.richness_score({"data": None}) == 0
    assert fre.richness_score({"data": {}}) == 0
    assert fre.richness_score({"data": {"location": {}}}) == 0
    # sem "data" mas com chaves fora — score continua 0
    assert fre.richness_score({"name": "X", "phone": "1"}) == 0


def test_richness_score_sem_contato_mas_com_endereco_e_cuisine():
    e = _entity(data={"contact": None, "location": {"address": "Rua X"}, "cuisine": ["bar"]})
    assert fre.richness_score(e) == 2


# --- has_coordinates ---------------------------------------------------------

def test_has_coordinates_true_quando_presentes():
    assert fre.has_coordinates(_entity()) is True


def test_has_coordinates_false_nos_shapes_de_borda():
    assert fre.has_coordinates({}) is False
    assert fre.has_coordinates({"data": None}) is False
    assert fre.has_coordinates({"data": {}}) is False
    assert fre.has_coordinates({"data": {"location": {}}}) is False
    assert fre.has_coordinates(_entity(data={"location": {"coordinates": None}})) is False
    assert fre.has_coordinates(_entity(data={"location": {"coordinates": {}}})) is False
    assert fre.has_coordinates(_entity(data={"location": {"coordinates": []}})) is False


# --- is_rich -----------------------------------------------------------------

def test_is_rich_exige_coordenadas_e_score():
    rico = _entity()
    assert fre.is_rich(rico, 4) is True
    # sem coordenadas nunca passa, mesmo com score alto
    sem_coord = _entity(data={
        "contact": {"phone": "1", "website": "1", "email": "1"},
        "location": {"address": "Rua X"},
        "cuisine": None,
    })
    assert fre.richness_score(sem_coord) == 4
    assert fre.is_rich(sem_coord, 4) is False
    # com coordenadas mas score baixo não passa
    pobre = _entity(data={
        "contact": None,
        "location": {"coordinates": {"lat": 1, "lng": 2}},
        "cuisine": None,
    })
    assert fre.is_rich(pobre, 4) is False


def test_is_rich_respeita_o_limiar_min_score():
    # 3 campos ricos (phone + postal + address) com coordenadas
    e = _entity(data={
        "contact": {"phone": "1"},
        "location": {"coordinates": {"lat": 1, "lng": 2}, "postal_code": "x", "address": "y"},
        "cuisine": None,
    })
    assert fre.richness_score(e) == 3
    assert fre.is_rich(e, 3) is True      # na fronteira passa
    assert fre.is_rich(e, 4) is False     # um abaixo do limiar não


def test_min_score_zero_aceita_qualquer_entity_com_coordenadas():
    e = _entity(data={"location": {"coordinates": {"lat": 1, "lng": 2}}})
    assert fre.is_rich(e, 0) is True


# --- parse_args --------------------------------------------------------------

def test_parse_args_min_score_default_e_quatro(monkeypatch):
    monkeypatch.setattr("sys.argv", ["prog", "--input", "data/x.json"])
    args = fre.parse_args()
    assert args.min_score == 4
    assert args.output is None
    assert args.sweep is False


def test_parse_args_aceita_min_score_e_output(monkeypatch):
    monkeypatch.setattr("sys.argv", ["prog", "--input", "x.json", "--output", "y.json", "--min-score", "6", "--sweep"])
    args = fre.parse_args()
    assert args.min_score == 6
    assert args.output == "y.json"
    assert args.sweep is True


# --- coverage ----------------------------------------------------------------

def test_coverage_vazio_imprime_placeholder(capsys):
    fre.coverage([])
    out = capsys.readouterr().out
    assert "(empty)" in out


def test_coverage_imprime_contagens_e_percentuais(capsys):
    a = _entity()                                                  # tudo
    b = _entity(data={"contact": {"phone": "1"}, "location": None, "cuisine": None})  # só phone
    c = _entity(data={"contact": None, "location": None, "cuisine": None})            # nada
    fre.coverage([a, b, c])
    out = capsys.readouterr().out
    assert "phone:" in out and "website:" in out and "instagram:" in out
    assert "postal:" in out and "address:" in out
    # phone: a+b = 2 de 3 (66%); website/postal/address: só a = 1 de 3 (33%).
    # O percentual é alinhado à direita em largura 3 → "( 66%)".
    assert "2 ( 66%)" in out
    assert "1 ( 33%)" in out


# --- main --------------------------------------------------------------------

def test_main_dry_run_nao_escreve_arquivo(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    src.write_text(json.dumps([_entity()]), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src)])
    assert fre.main() == 0
    out = capsys.readouterr().out
    assert "Rich (score >= 4): 1  (100% of input)" in out
    assert "Coverage in rich subset:" in out
    assert "(dry-run" in out
    assert "Saved:" not in out


def test_main_output_escreve_apenas_os_rich(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    rico = _entity(entity_id="osm_rico")
    no_score = _entity(entity_id="osm_pobre", data={"contact": None, "location": None, "cuisine": None})
    sem_coord = _entity(entity_id="osm_sem_coord", data={
        "contact": {"phone": "1", "website": "1", "email": "1",
                    "facebook": "1", "instagram": "1"},
        "location": {"address": "Rua X"},
        "cuisine": None,
    })  # score 6 (passa no limiar) mas SEM coordenadas → excluída
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src),
                                     "--output", str(tmp_path / "out.json"),
                                     "--min-score", "6"])
    src.write_text(json.dumps([rico, no_score, sem_coord]), encoding="utf-8")
    assert fre.main() == 0

    saved = json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))
    assert [e["entity_id"] for e in saved] == ["osm_rico"]  # pass-through integral
    assert saved[0] == rico                                  # sem transformação
    out = capsys.readouterr().out
    assert "Saved:" in out


def test_main_output_cria_diretorios_aninhados(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    src.write_text(json.dumps([_entity()]), encoding="utf-8")
    out = tmp_path / "nested" / "deeper" / "out.json"  # pais não existem
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src), "--output", str(out)])
    assert fre.main() == 0
    assert out.exists()


def test_main_grava_utf8_sem_escape(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    ent = _entity(name="Cantina da Vó Zé")
    src.write_text(json.dumps([ent]), encoding="utf-8")
    out = tmp_path / "out.json"
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src), "--output", str(out)])
    assert fre.main() == 0
    raw = out.read_text(encoding="utf-8")
    assert "Cantina da Vó Zé" in raw  # ensure_ascii=False preserva acentos


def test_main_arquivo_inexistente_retorna_1(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(tmp_path / "nao-existe.json")])
    assert fre.main() == 1
    out = capsys.readouterr().out
    assert "ERROR: file not found" in out


def test_main_arquivo_vazio_nao_quebra(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    src.write_text("[]", encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src)])
    assert fre.main() == 0
    out = capsys.readouterr().out
    assert "Rich (score >= 4): 0  (0% of input)" in out


def test_main_sweep_imprime_linhas_por_limiar_sem_escrever(tmp_path, capsys, monkeypatch):
    src = tmp_path / "in.json"
    rico = _entity()
    pobre = _entity(entity_id="pobre", data={"contact": None, "location": None, "cuisine": None})
    src.write_text(json.dumps([rico, pobre]), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["prog", "--input", str(src), "--sweep"])
    assert fre.main() == 0
    out = capsys.readouterr().out
    assert "Threshold sweep (min-score → kept):" in out
    assert "score >= 2:" in out
    assert "score >= 6:" in out
    assert "1  (50%)" in out          # 1 de 2 passa em qualquer limiar >= 2
    assert "Saved:" not in out
