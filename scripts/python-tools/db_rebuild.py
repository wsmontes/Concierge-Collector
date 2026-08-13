#!/usr/bin/env python3
"""
File: db_rebuild.py
Purpose: Reconstrução do MongoDB após estouro de cota (incidente 2026-08-12):
         exporta TUDO em BSON local com manifest.json, apaga as coleções
         (com confirmação E verify passando) e repopula com embeddings
         compactados (Binary float32 — ~6KB/vetor em vez de ~20KB).
Dependencies: pymongo, bson (venv de concierge-api-v3); mongo_tools (mesmo dir)
Usage:
  python3 db_rebuild.py export        # grava data/backups/full-dump-2026-08-12/<coll>.bson + manifest.json
  python3 db_rebuild.py verify        # decodifica o dump inteiro e compara com o banco vivo
  python3 db_rebuild.py wipe --yes    # apaga TODAS as coleções (exige verify passando)
  python3 db_rebuild.py restore --yes # substitui cada coleção do manifest, compactada, e recria índices
"""
import json
import os
import struct
import sys
from datetime import datetime, timezone

from bson import BSON
from bson.errors import BSONError
from bson.raw_bson import RawBSONDocument
from pymongo.errors import PyMongoError

import mongo_tools
from app.core.index_specs import INDEX_SPECS  # noqa: E402  (via sys.path do mongo_tools)

DUMP_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "data",
    "backups",
    "full-dump-2026-08-12",
)
MANIFEST_NAME = "manifest.json"

# MongoDB rejeita mensagens bulk acima de ~48MB (maxMessageSizeBytes); uma
# curadoria tem ~150KB (dezenas de vetores de 6KB), então um lote de 1000 docs
# pesaria 150MB+. Lotes são limitados por BYTES serializados, não por contagem.
INSERT_BATCH_BYTES = 10 * 1024 * 1024

# Chaves únicas de entities — duplicatas nelas (incidente 2026-08-12) impedem
# a recriação dos índices unique; o restore deduplica antes de inserir.
ENTITY_UNIQUE_KEYS = ("externalId", "data.place_id")

# Fonte única das specs de índice (app/core/index_specs.py) — importada acima.


def write_bson_stream(path, docs_iter):
    """Grava docs em BSON (prefixo int32 + doc) com escrita atômica:
    vai para <path>.tmp e só substitui o arquivo final no sucesso — um export
    re-executado nunca trunca o dump anterior no meio da escrita.
    Retorna o número de docs gravados."""
    tmp_path = path + ".tmp"
    count = 0
    try:
        with open(tmp_path, "wb") as f:
            for doc in docs_iter:
                raw = BSON.encode(doc)
                f.write(struct.pack("<i", len(raw)))
                f.write(raw)
                count += 1
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return count


def read_bson_stream(path):
    """Lê o stream BSON do export, validando cada tamanho lido.
    Levanta ValueError com o nome do arquivo se o stream estiver truncado;
    corrupção de conteúdo levanta bson.errors.InvalidBSON no decode."""
    with open(path, "rb") as f:
        while True:
            hdr = f.read(4)
            if not hdr:
                return
            if len(hdr) != 4:
                raise ValueError(
                    f"{path}: stream truncado no header (offset {f.tell()})"
                )
            (size,) = struct.unpack("<i", hdr)
            if size <= 0:
                raise ValueError(
                    f"{path}: header inválido ({size} bytes) — stream corrompido"
                )
            raw = f.read(size)
            if len(raw) != size:
                raise ValueError(
                    f"{path}: documento truncado em {len(raw)} de {size} bytes"
                )
            yield BSON(raw).decode()


def _pack_or_skip(vector, doc_id):
    """Retorna (valor_empacotado_ou_None, pulou_1_ou_0). Vetor ausente/vazio/
    malformado/dimensão errada: a ENTRADA é removida por inteiro (o None de
    retorno sinaliza a remoção) — o formato caro nunca re-entra no Mongo e a
    curadoria volta a ser elegível para o backfill."""
    if isinstance(vector, bytes):
        return vector, 0
    packed = mongo_tools.try_pack_vector(
        vector, expected_dim=mongo_tools.DEFAULT_EMBEDDING_DIMENSIONS
    )
    if packed is None:
        print(
            f"  AVISO: vetor REMOVIDO (ausente/vazio/malformado/dimensão "
            f"errada) em {doc_id}"
        )
        return None, 1
    return packed, 0


def compact_doc(doc):
    """Converte vetores double→Binary float32 em qualquer posição do doc:
    campo 'vector' no topo (coleções legadas, ex. 'embeddings') e dentro de
    cada entrada de 'embeddings' (curadorias). Entrada com vetor
    ausente/vazio/malformado/dimensão errada é REMOVIDA por inteiro — nunca
    re-entra no Mongo no formato caro que estourou a cota, e a curadoria
    volta a ser elegível para o backfill. Retorna (doc, pulados)."""
    skipped = 0
    if "vector" in doc:
        new, s = _pack_or_skip(doc["vector"], doc.get("_id"))
        skipped += s
        if new is not None:
            doc["vector"] = new
        else:
            doc.pop("vector", None)
    embs = doc.get("embeddings")
    if isinstance(embs, list):
        novas = []
        for emb in embs:
            if isinstance(emb, dict) and "vector" in emb:
                new, s = _pack_or_skip(emb["vector"], doc.get("_id"))
                skipped += s
                if new is None:
                    continue  # entrada removida por inteiro
                emb["vector"] = new
            novas.append(emb)
        # drop parcial preserva os vetores válidos (o restore não destrói o
        # que está bom) e SINALIZA o backfill — sem a flag, o filtro do
        # backfill não re-selecionaria a curadoria e os textos dropados
        # ficariam perdidos para sempre
        doc["embeddings"] = novas
        if skipped > 0:
            meta = doc.get("embeddings_metadata")
            # metadata não-mapping (list/string de escrita crua) não pode
            # quebrar o **splat no meio do restore
            base = meta if isinstance(meta, dict) else {}
            doc["embeddings_metadata"] = {**base, "backfill_needed": True}
    return doc, skipped


def write_manifest(dump_dir, manifest):
    path = os.path.join(dump_dir, MANIFEST_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp, path)


def read_manifest(dump_dir):
    """Lê o manifest.json do dump; None se ausente."""
    path = os.path.join(dump_dir, MANIFEST_NAME)
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        return json.load(f)


def validate_dump_files(dump_dir, manifest):
    """Confere TODOS os arquivos do manifest: presença, tamanho vs manifest,
    decodificação COMPLETA (truncamento/corrupção) e contagem. Única fonte
    dessas checagens — usada pelo verify (reporta por coleção) e pelo restore
    (aborta antes de dropar). Retorna (problemas, contagens) onde problemas é
    [(coleção, mensagem)] e contagens é {coll: n} das coleções íntegras."""
    problems = []
    counts = {}
    for coll, meta in sorted(manifest["collections"].items()):
        path = os.path.join(dump_dir, f"{coll}.bson")
        if not os.path.isfile(path):
            problems.append((coll, f"FALTA {coll}.bson (citada no manifest)"))
            continue
        size = os.path.getsize(path)
        if size != meta.get("bytes"):
            problems.append(
                (coll, f"DIVERGE tamanho do arquivo (dump={size} manifest={meta.get('bytes')})")
            )
            continue
        try:
            n = sum(1 for _ in read_bson_stream(path))
        except (ValueError, BSONError) as e:
            problems.append((coll, f"CORROMPIDO — {e}"))
            continue
        if n != meta["count"]:
            problems.append(
                (coll, f"DIVERGE contagem (dump={n} manifest={meta['count']})")
            )
            continue
        counts[coll] = n
    return problems, counts


def export_dump(client, db, dump_dir):
    """Exporta todas as coleções em BSON + manifest.json (contagens, bytes,
    timestamps). Retorna o manifest gravado."""
    os.makedirs(dump_dir, exist_ok=True)
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": db.name,
        "cluster": ":".join(str(p) for p in client.address) if client.address else "?",
        "collections": {},
    }
    for coll in sorted(db.list_collection_names()):
        # maior updatedAt ANTES do stream: se um PATCH concorrente acontecer
        # durante o export, o manifest fica CONSERVADOR (max mais velho que o
        # conteúdo dumpado) e os gates de frescor pegam a diferença — ler
        # DEPOIS gravaria um max mais novo que o conteúdo e aprovaria dump
        # obsoleto no verify/restore
        last = db[coll].find_one({}, {"updatedAt": 1}, sort=[("updatedAt", -1)])
        max_updated_at = None
        if last and last.get("updatedAt"):
            ts = last["updatedAt"]
            max_updated_at = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        path = os.path.join(dump_dir, f"{coll}.bson")
        # batch grande: menos getMore sobre a WAN; o servidor já limita cada
        # batch de resposta a ~16MB por conta própria
        count = write_bson_stream(path, db[coll].find({}, batch_size=1000))
        manifest["collections"][coll] = {
            "count": count,
            "bytes": os.path.getsize(path),
            "max_updated_at": max_updated_at,
        }
        print(
            f"{coll}: {count} docs, "
            f'{manifest["collections"][coll]["bytes"] // 1024} KB exportados'
        )
    write_manifest(dump_dir, manifest)
    print(f"EXPORT OK ({MANIFEST_NAME} gravado)")
    return manifest


def _live_updated_after_export(db, coll, meta):
    """True se o banco vivo tem doc com updatedAt posterior ao máximo gravado
    no manifest (PATCH in-place pós-export — contagem igual, conteúdo novo).
    Sem dado comparável → False (não bloqueia)."""
    manifest_max = meta.get("max_updated_at")
    if not manifest_max:
        return False
    last = db[coll].find_one({}, {"updatedAt": 1}, sort=[("updatedAt", -1)])
    if not last or not last.get("updatedAt"):
        return False
    return _epoch(last["updatedAt"]) > _epoch(manifest_max)


def verify_dump(db, dump_dir):
    """Confere o dump contra o banco vivo ANTES de qualquer wipe:
    1. toda coleção viva precisa estar no manifest (criada pós-export = sem backup);
    2. cada arquivo do dump é DECODIFICADO por inteiro (corrupção de mesmo
       tamanho — bit rot — só é pega aqui) e comparado com manifest e banco vivo.
    Retorna True se tudo bate."""
    manifest = read_manifest(dump_dir)
    if manifest is None:
        print(
            f"VERIFY FALHOU: {MANIFEST_NAME} ausente em {dump_dir} — "
            "rode 'export' primeiro"
        )
        return False
    ok = True

    if manifest.get("database") and manifest["database"] != db.name:
        print(
            f"Dump é do banco '{manifest.get('database')}', conexão aponta "
            f"para '{db.name}' — VERIFY FALHOU"
        )
        return False

    for coll in sorted(db.list_collection_names()):
        if coll not in manifest["collections"]:
            print(
                f"SEM DUMP: coleção viva '{coll}' não está no manifest — "
                "exporte de novo antes de qualquer wipe"
            )
            ok = False

    problems, counts = validate_dump_files(dump_dir, manifest)
    for coll, msg in problems:
        print(f"{coll}: {msg}")
        ok = False

    # Gates de frescor FAIL-CLOSED: erro de conexão NUNCA vira 'live=0' —
    # aprovar um wipe por cima de um blip de rede destruiria dados novos.
    for coll, n in sorted(counts.items()):
        try:
            live = db[coll].count_documents({})
        except PyMongoError as e:
            print(f"{coll}: ERRO de conexão consultando o banco vivo ({e}) — VERIFY FALHOU")
            ok = False
            continue
        if live > n:
            print(
                f"{coll}: DIVERGE dump={n} live={live} — banco vivo tem mais "
                "docs que o dump (dump obsoleto, re-exporte)"
            )
            ok = False
        elif _live_updated_after_export(db, coll, manifest["collections"].get(coll, {})):
            print(
                f"{coll}: DIVERGE — banco vivo tem atualização posterior ao "
                "export (dump obsoleto, re-exporte)"
            )
            ok = False
        elif live != n:
            print(f"{coll}: dump={n} live={live} (dump é superconjunto — OK)")
        else:
            print(f"{coll}: dump={n} live={live} OK")

    idade = None
    if manifest.get("created_at"):
        try:
            criado = datetime.fromisoformat(manifest["created_at"])
            if criado.tzinfo is None:
                criado = criado.replace(tzinfo=timezone.utc)
            idade = datetime.now(timezone.utc) - criado
        except (ValueError, TypeError):
            idade = None
    idade_txt = f"{idade}" if idade is not None else "?"
    print(
        f"Dump de {manifest.get('created_at') or '?'} ({idade_txt}) — "
        f"banco {manifest.get('database')} @ {manifest.get('cluster')}"
    )
    print("VERIFY OK" if ok else "VERIFY FALHOU")
    return ok


def ensure_indexes(db):
    """Recria os índices (espelha app/core/database.py + lifespan.py) com
    tolerância a falha individual: um índice único que não consiga ser criado
    (ex.: duplicatas no dump) é reportado sem abortar os demais.
    Retorna [(descrição, ok, erro)]."""
    results = []
    for coll, keys, extra in INDEX_SPECS:
        kwargs = {**extra, "background": True}
        desc = f"{coll} {keys}"
        try:
            db[coll].create_index(keys, **kwargs)
            results.append((desc, True, ""))
        except Exception as e:
            results.append((desc, False, str(e)[:120]))
            print(f"  ÍNDICE FALHOU {desc}: {str(e)[:120]}")
    return results


def _nested_get(doc, dotted_key):
    """Resolve chave pontuada aninhada ('data.place_id' vive DENTRO do dict
    'data') — doc.get('data.place_id') jamais encontra o campo."""
    value = doc
    for part in dotted_key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _epoch(ts):
    """updatedAt → epoch (float) para comparação por INSTANTE. Aceita datetime
    (naive = UTC), string ISO e NÚMEROS (epoch em segundos ou ms — comuns em
    pipelines bulk; um número NÃO pode virar 0.0 e abrir o gate de frescor).
    Inválido/ausente = 0.0 (mais antigo)."""
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.timestamp()
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        f = float(ts)
        if f != f or f in (float("inf"), float("-inf")):
            return 0.0  # nan/inf não são instantes válidos
        # >1e11 = milissegundos (epoch ~1.7e9 em segundos)
        return f / 1000.0 if f > 1e11 else f
    if isinstance(ts, str) and ts:
        # '20240813' é data compacta (fromisoformat aceita), NÃO epoch —
        # tenta data compacta/ISO ANTES do número
        if len(ts) == 8 and ts.isdigit():
            try:
                dt = datetime.fromisoformat(ts)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.timestamp()
            except ValueError:
                pass
        try:
            # manifest grava updatedAt numérico como str(ts)
            f = float(ts)
            if f != f or f in (float("inf"), float("-inf")):
                return 0.0  # nan/inf não são instantes válidos
            return f / 1000.0 if f > 1e11 else f
        except ValueError:
            pass
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            return 0.0
    return 0.0


def _hashable_key(value):
    """Chave única do dedupe com a SEMÂNTICA de comparação do índice único
    do Mongo: números comparam POR VALOR (1 == 1.0 == True, e NaN == NaN
    para unicidade); strings só colidem com strings; dict/list (lixo de
    import) usa repr em vez de crashar o set."""
    if isinstance(value, bool):
        return ("num", 1.0 if value else 0.0)
    if isinstance(value, (int, float)):
        f = float(value)
        return ("num", "nan" if f != f else f)
    if isinstance(value, str):
        return ("str", value)
    if isinstance(value, bytes):
        return ("bytes", value)
    return (type(value).__name__, repr(value))


def _nested_exists(doc, dotted_key):
    """True se o caminho pontuado EXISTE no doc (mesmo com valor None) —
    _nested_get não distingue 'ausente' de 'null explícito'."""
    value = doc
    for part in dotted_key.split("."):
        if not isinstance(value, dict) or part not in value:
            return False
        value = value[part]
    return True


def _unset_nested(doc, dotted_key):
    """Remove o campo folha de uma chave pontuada ('data.place_id').
    Unset em vez de null: índices unique SPARSE não indexam campo AUSENTE —
    null explícito É indexado e causaria DuplicateKey (o log de produção do
    incidente mostra exatamente 'dup key: { externalId: null }')."""
    parts = dotted_key.split(".")
    target = doc
    for part in parts[:-1]:
        if not isinstance(target.get(part), dict):
            return
        target = target[part]
    target.pop(parts[-1], None)


def dedupe_entities(docs):
    """Elimina duplicatas de entities sobre as chaves únicas (externalId,
    data.place_id) SEM descartar dados: docs são processados do mais recente
    ao mais antigo (epoch, com string ISO suportada); o primeiro doc a
    reivindicar um (chave, valor) fica com ele; docs posteriores com o mesmo
    valor têm a CHAVE removida (unset — índice sparse ignora) e sobrevivem
    com as demais chaves; docs que ficam sem nenhuma chave única são
    removidos (curadorias reescritas via o mapa de rewrite retornado).
    Resultado: nenhuma chave única tem duplicata (índices unique criáveis)
    e nenhum valor único é perdido. Docs sem chave única nunca conflitam.
    Desempate por _id. Retorna (mantidos, removidos, rewrite) — o mapa de
    _id removido → _id do dono é montado durante a resolução (as chaves do
    doc removido já foram desfeitas pelo unset)."""
    def sort_key(doc):
        return (_epoch(doc.get("updatedAt")), str(doc.get("_id")))

    docs = list(docs)
    claimed = {}  # (chave, valor tipado) -> _id do dono
    rewrite = {}
    removed_ids = set()
    for doc in sorted(docs, key=sort_key, reverse=True):
        originais = {k: _nested_get(doc, k) for k in ENTITY_UNIQUE_KEYS}
        tinha_valor_real = any(v is not None for v in originais.values())
        reivindicou = False
        for key in ENTITY_UNIQUE_KEYS:
            value = originais[key]
            if value is None:
                if _nested_exists(doc, key):
                    # null EXPLÍCITO é indexado pelo unique SPARSE do Mongo
                    # ('dup key: { externalId: null }' no log do incidente) —
                    # ~21k entities têm externalId: null. Unset deixa o campo
                    # AUSENTE, que o sparse ignora.
                    _unset_nested(doc, key)
                continue
            hv = _hashable_key(value)
            if (key, hv) in claimed:
                _unset_nested(doc, key)  # conflito: perde só esta chave
            else:
                claimed[(key, hv)] = doc["_id"]
                reivindicou = True
        # Só é removido quem TINHA valor real e perdeu todas as chaves para
        # docs mais novos — docs só com nulls ficam (com os nulls unsetados).
        if tinha_valor_real and not reivindicou and not any(
            _nested_get(doc, k) is not None for k in ENTITY_UNIQUE_KEYS
        ):
            removed_ids.add(id(doc))
            # rewrite montada AQUI: as chaves originais do doc removido já
            # foram desfeitas pelo unset, então usa o snapshot 'originais'
            for key in ENTITY_UNIQUE_KEYS:
                value = originais[key]
                if value is None:
                    continue
                dono_id = claimed.get((key, _hashable_key(value)))
                if dono_id:
                    # chaveia por str(_id) (hex para ObjectId) E pelo slug
                    # (entity_id): curadorias referenciam ambos os formatos
                    dono = next((d for d in docs if d["_id"] == dono_id), None)
                    valor_dono = (dono or {}).get("entity_id") or str((dono or {}).get("_id", dono_id))
                    rewrite.setdefault(str(doc["_id"]), valor_dono)
                    slug_removido = doc.get("entity_id")
                    if slug_removido:
                        rewrite.setdefault(slug_removido, valor_dono)
                    break
    kept = [d for d in docs if id(d) not in removed_ids]
    removed = [d for d in docs if id(d) in removed_ids]
    return kept, removed, rewrite


def _rewrite_entity_ids(docs, rewrite):
    """Reescreve curations.entity_id conforme o mapa do dedupe. Retorna
    (docs_reescritos, contagem)."""
    out, rewritas = [], 0
    for doc in docs:
        eid = doc.get("entity_id")
        # só tipos hashable (lixo de import não pode crashar o restore)
        if isinstance(eid, (str, int, float, bytes)) and eid in rewrite:
            doc["entity_id"] = rewrite[eid]
            rewritas += 1
        out.append(doc)
    return out, rewritas


def insert_in_byte_batches(coll, docs, max_bytes):
    """Insere docs em lotes limitados por BYTES serializados — o servidor
    rejeita mensagens bulk acima de ~48MB (maxMessageSizeBytes). Cada doc é
    codificado UMA vez e enviado como RawBSONDocument (a inserção não
    re-codifica os bytes já medidos)."""
    batch, size, total = [], 0, 0
    for doc in docs:
        raw = BSON.encode(doc)
        n = len(raw)
        if batch and size + n > max_bytes:
            coll.insert_many(batch)
            total += len(batch)
            batch, size = [], 0
        batch.append(RawBSONDocument(raw))
        size += n
    if batch:
        coll.insert_many(batch)
        total += len(batch)
    return total


def restore_dump(db, dump_dir, confirmed):
    """Substitui cada coleção do MANIFEST (drop + insert) com vetores
    compactados e recria os índices ao final. Gates: exige --yes, exige
    manifest, PRÉ-VALIDA todos os arquivos ANTES de dropar (um dump corrompido
    nunca apaga o que o banco ainda tem) e recusa se o banco vivo for mais
    novo que o dump (writes pós-export seriam destruídos) ou de outro banco.
    Idempotente/resumível: rerun após falha parcial re-dropa e reinsere.
    Retorna (contagens, falhas_de_índice) — falhas NÃO são sucesso."""
    if not confirmed:
        raise ValueError(
            "restore exige confirmação explícita: rode 'restore --yes' — ele "
            "SUBSTITUI cada coleção do manifest"
        )
    manifest = read_manifest(dump_dir)
    if manifest is None:
        raise ValueError(
            f"{MANIFEST_NAME} ausente em {dump_dir} — rode 'export' primeiro"
        )
    if not manifest.get("collections"):
        raise ValueError(
            f"{MANIFEST_NAME} não lista nenhuma coleção — rode 'export' primeiro"
        )
    if manifest.get("database") and manifest["database"] != db.name:
        raise ValueError(
            f"Dump é do banco '{manifest.get('database')}', mas a conexão "
            f"aponta para '{db.name}' — restore abortado"
        )
    files = sorted(f for f in os.listdir(dump_dir) if f.endswith(".bson"))
    esperados = {f"{c}.bson" for c in manifest["collections"]}
    extras = sorted(set(files) - esperados)
    if extras:
        print(
            f"AVISO: {extras} no diretório sem manifest — NÃO serão restaurados "
            "(coleções arquivadas à mão: re-exporte-as antes do wipe para "
            "voltarem ao fluxo)"
        )

    # Mesmo invariante do wipe: coleção viva fora do manifest = sem backup
    for coll in sorted(db.list_collection_names()):
        if coll not in manifest["collections"]:
            raise ValueError(
                f"Coleção viva '{coll}' não está no manifest (SEM DUMP) — "
                "restore abortado ANTES de qualquer drop"
            )

    # Pré-validação: nada é dropado se QUALQUER arquivo estiver corrompido
    problems, counts = validate_dump_files(dump_dir, manifest)
    if problems:
        detalhe = "; ".join(f"{c}: {m}" for c, m in problems)
        raise ValueError(f"Dump com problemas ({detalhe}) — restore abortado ANTES de qualquer drop")

    # Gates de frescor FAIL-CLOSED: erro de conexão propaga (main reporta e
    # orienta rerun); aprovar por cima de um blip destruiria dados novos.
    for coll, n in sorted(counts.items()):
        live = db[coll].count_documents({})
        if live > n:
            raise ValueError(
                f"{coll}: banco vivo tem {live} docs, dump tem {n} — dados "
                "novos desde o export seriam destruídos; re-exporte antes do restore"
            )
        if _live_updated_after_export(db, coll, manifest["collections"].get(coll, {})):
            raise ValueError(
                f"{coll}: banco vivo tem atualização posterior ao export — "
                "restore recusado (dump obsoleto); re-exporte"
            )

    # Fase de substituição (drop + insert em lotes por bytes). Entities vem
    # PRIMEIRO: o dedupe gera o mapa de rewrite que o restore de curations
    # aplica em entity_id (sem referência órfã pós-dedupe).
    sem_updated_at = [c for c in counts if not manifest["collections"].get(c, {}).get("max_updated_at")]
    if sem_updated_at:
        print(
            f"AVISO: {sorted(sem_updated_at)} sem updatedAt no manifest — "
            "edições in-place pós-export nessas coleções não são detectáveis"
        )
    order = (["entities"] if "entities" in counts else []) + sorted(
        c for c in counts if c != "entities"
    )
    rewrite = {}
    inseridos_por_coll = {}
    for coll in order:
        path = os.path.join(dump_dir, f"{coll}.bson")
        db[coll].drop()
        docs = (compact_doc(doc)[0] for doc in read_bson_stream(path))
        removidos = 0
        if coll == "entities":
            docs, removidos, rewrite = dedupe_entities(list(docs))
        elif coll == "curations" and rewrite:
            docs, rewritas = _rewrite_entity_ids(docs, rewrite)
            if rewritas:
                print(f"  {rewritas} curations com entity_id reescrito pós-dedupe")
        inseridos = insert_in_byte_batches(db[coll], docs, INSERT_BATCH_BYTES)
        inseridos_por_coll[coll] = inseridos
        linha = f"{coll}: {inseridos} docs reinseridos (vetores compactados)"
        if removidos:
            linha += f", {removidos} duplicatas de chave única removidas"
        print(linha)

    index_results = ensure_indexes(db)
    falhas = [r for r in index_results if not r[1]]
    if falhas:
        print(f"ATENÇÃO: {len(falhas)} índice(s) não criado(s):")
        for desc, _, err in falhas:
            print(f"  - {desc}: {err}")
    return inseridos_por_coll, falhas


def wipe_db(client, db, dump_dir, confirmed):
    """Apaga todas as coleções do banco. Exige confirmed=True (flag --yes)
    E que o verify do dump passe — sem dump íntegro não há volta."""
    if not confirmed:
        print(f"Cluster: {client.address} | banco: {db.name}")
        print(f"Coleções que seriam apagadas: {sorted(db.list_collection_names())}")
        raise ValueError(
            "wipe exige confirmação explícita: rode 'wipe --yes' após conferir "
            "cluster/banco acima"
        )
    # Snapshot ANTES do verify: coleção criada por processo concorrente entre
    # o verify e o drop não está no dump e nunca seria restaurada
    snapshot = sorted(db.list_collection_names())
    if not verify_dump(db, dump_dir):
        raise ValueError("VERIFY FALHOU — wipe recusado (sem dump íntegro não há volta)")
    agora = sorted(db.list_collection_names())
    if agora != snapshot:
        raise ValueError(
            f"Coleções mudaram durante o verify ({snapshot} → {agora}) — "
            "wipe recusado; rode de novo"
        )
    dropped = []
    for coll in snapshot:
        db[coll].drop()
        dropped.append(coll)
        print(f"{coll}: dropada")
    print("WIPE OK")
    return dropped


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "verify"
    confirmed = "--yes" in sys.argv
    try:
        client, db = mongo_tools.connect()
        print(f"Cluster: {client.address} | banco: {db.name}")
        if mode == "export":
            export_dump(client, db, DUMP_DIR)
            return 0
        if mode == "verify":
            return 0 if verify_dump(db, DUMP_DIR) else 1
        if mode == "wipe":
            wipe_db(client, db, DUMP_DIR, confirmed)
            return 0
        if mode == "restore":
            counts, falhas = restore_dump(db, DUMP_DIR, confirmed)
            if falhas:
                print(
                    f"RESTORE PARCIAL: {len(falhas)} índice(s) ausente(s) — "
                    "dados restaurados, uniqueness não garantida"
                )
                return 1
            print("RESTORE OK")
            return 0
        print(f"Modo desconhecido: {mode} (export|verify|wipe|restore)")
        return 1
    except (ValueError, BSONError, PyMongoError, KeyError, OSError, TypeError) as e:
        print(f"ERRO: {e}")
        if mode == "restore":
            print(
                "Dica: o banco pode estar parcialmente restaurado — rode "
                "'restore --yes' de novo (idempotente)"
            )
        elif mode in ("export", "verify", "wipe"):
            print("Dica: confira MONGODB_URL/MONGODB_DB_NAME no .env e a conexão")
        return 1


if __name__ == "__main__":
    sys.exit(main())
