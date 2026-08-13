#!/usr/bin/env python3
"""
File: backfill_embeddings.py
Purpose: Backfill de embeddings OpenAI (text-embedding-3-small, 1536d) para curadorias sem
         embeddings — direto no MongoDB (como o resto do pipeline), para que semantic-search
         e hybrid-search cubram ~100% das curadorias. Aprovado pelo usuário em 2026-08-12.
Dependencies: openai (venv de concierge-api-v3); mongo_tools (mesmo dir, puxa pymongo/bson)
Usage:
  python3 backfill_embeddings.py dry-run   # conta textos e estima custo, sem escrever
  python3 backfill_embeddings.py go        # executa o backfill
"""
import os
import sys
import time
from datetime import datetime, timezone

from openai import OpenAI

import mongo_tools

EMBEDDING_MODEL = 'text-embedding-3-small'
EMBEDDING_DIMENSIONS = 1536
OPENAI_BATCH = 100  # textos por chamada
DELAY_BETWEEN_BATCHES = 1.0
PRICE_PER_1M_TOKENS = 0.02  # USD, text-embedding-3-small

# Filtro de seleção do backfill (exercitado nos testes via fakes que aplicam
# o filtro de verdade — uma regressão aqui re-embutiria curadorias erradas).
CURATIONS_FILTRO = {
    '$or': [
        {'embeddings': {'$exists': False}},
        {'embeddings': []},
        {'embeddings_metadata.backfill_needed': True},
    ],
    'status': {'$ne': 'deleted'},
}


def curation_texts(curation):
    """Pares 'category concept' — mesmo formato de generate_embeddings.py."""
    texts, meta = [], []
    for category, concepts in (curation.get('categories') or {}).items():
        if not isinstance(concepts, list):
            continue
        for concept in concepts:
            text = f'{category} {concept}'
            texts.append(text)
            meta.append({'category': category, 'concept': concept, 'text': text})
    return texts, meta


def load_env_backfill(path=None):
    """Precedência do backfill: o .env é a fonte da verdade para o Mongo.
    Se o .env NÃO contém MONGODB_URL/MONGODB_DB_NAME, recusa em vez de herdar
    valores obsoletos do shell (always_env só protege chaves presentes no
    arquivo; MONGODB_DB_NAME herdada retargetaria o banco silenciosamente)."""
    loaded = mongo_tools.load_env(path, always_env=("MONGODB_URL", "MONGODB_DB_NAME"))
    faltando = [k for k in ("MONGODB_URL", "MONGODB_DB_NAME") if k not in loaded]
    if faltando:
        raise ValueError(
            f"{', '.join(faltando)} ausente(s) do .env — backfill recusa rodar "
            "contra valor do shell (cluster/banco errado escreveria embeddings "
            "no lugar errado)"
        )


def build_embeddings(vectors_by_text, meta):
    """Monta as entradas de embeddings usando a política única de
    empacotamento (try_pack_vector): vetor ausente/vazio/malformado é PULADO
    e contabilizado — nunca vira Binary(b'') nem array de doubles."""
    embeddings, skipped = [], 0
    for m in meta:
        if m["text"] not in vectors_by_text:
            skipped += 1
            continue
        packed = mongo_tools.try_pack_vector(vectors_by_text[m["text"]])
        if packed is None:
            skipped += 1
            continue
        embeddings.append(
            {"text": m["text"], "category": m["category"],
             "concept": m["concept"], "vector": packed}
        )
    return embeddings, skipped


def store_embeddings(db, curation_id, embeddings, metadata):
    """$set de embeddings em uma curadoria filtrando pelo valor REAL de _id
    (str ou ObjectId — str(ObjectId) nunca casa com _id ObjectId de bulk
    imports). updatedAt É atualizado junto: os gates de frescor do db_rebuild
    (contagem + max_updated_at) detectam o backfill pós-export — sem isso um
    wipe/restore reverteria silenciosamente os embeddings recém-gravados.
    Retorna (ok, matched_count) — matched_count 0 é falha visível."""
    result = db.curations.update_one({'_id': curation_id}, {'$set': {
        'embeddings': embeddings,
        'embeddings_metadata': metadata,
        'updatedAt': datetime.now(timezone.utc),
    }})
    return result.matched_count == 1, result.matched_count


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'dry-run'
    # Backfill NÃO é destrutivo: o .env vence para o Mongo também (e sem
    # MONGODB_URL no .env, recusa) — valor obsoleto do shell não retargeta
    load_env_backfill()
    client, db = mongo_tools.connect()
    # Garante que a chamada vá para a API real da OpenAI (não LM Studio local,
    # que o perfil do shell exporta) — específico deste script, não do Mongo
    os.environ.pop('OPENAI_BASE_URL', None)
    os.environ.pop('OPENAI_MODEL', None)
    oai = OpenAI(api_key=os.environ['OPENAI_API_KEY'], base_url='https://api.openai.com/v1')

    curations = list(db.curations.find(CURATIONS_FILTRO, {'_id': 1, 'categories': 1}))
    sem_textos = []
    trabalhos = []  # (curation_id real, texts, meta)
    total_textos = 0
    for c in curations:
        texts, meta = curation_texts(c)
        if not texts:
            sem_textos.append(str(c['_id']))
            continue
        trabalhos.append((c['_id'], texts, meta))  # valor real, não str()
        total_textos += len(texts)

    tokens_est = total_textos * 4  # ~4 tokens por texto curto
    custo_est = tokens_est / 1_000_000 * PRICE_PER_1M_TOKENS
    print(f'Curadorias sem embeddings: {len(curations)}')
    print(f'  com categorias (vão receber): {len(trabalhos)}')
    print(f'  sem categorias (nada a embutir): {len(sem_textos)}')
    print(f'Textos a embutir: {total_textos}')
    print(f'Custo estimado: ~US$ {custo_est:.4f} ({tokens_est} tokens)')
    if mode != 'go':
        print('\n(dry-run — nada foi escrito. Rode "go" para executar.)')
        return 0

    ok, falhas, embutidos = 0, 0, 0
    for i, (cid, texts, meta) in enumerate(trabalhos, 1):
        try:
            vectors = {}
            for start in range(0, len(texts), OPENAI_BATCH):
                batch = texts[start:start + OPENAI_BATCH]
                resp = oai.embeddings.create(input=batch, model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMENSIONS)
                for text, item in zip(batch, resp.data):
                    vectors[text] = item.embedding
                time.sleep(DELAY_BETWEEN_BATCHES)
            embeddings, pulados = build_embeddings(vectors, meta)
            if not embeddings:
                falhas += 1
                if pulados:
                    print(f'  FALHA {cid}: {pulados} vetor(es) ausente/vazio/malformado — nada gravado')
                continue
            stored, matched = store_embeddings(db, cid, embeddings, {
                'model': EMBEDDING_MODEL,
                'dimensions': EMBEDDING_DIMENSIONS,
                'total_embeddings': len(embeddings),
                'created_at': datetime.now(timezone.utc).isoformat(),
                'backfilled': True,
                # parcial (textos pulados) PRESERVA a pendência — sem a flag
                # os textos restantes nunca seriam re-selecionados
                'backfill_needed': pulados > 0,
            })
            if not stored:
                falhas += 1
                print(f'  FALHA {cid}: matched_count={matched} — _id não encontrado '
                      '(tipo incompatível?) — nada foi gravado')
                continue
            ok += 1
            embutidos += len(embeddings)
        except Exception as e:
            falhas += 1
            print(f'  FALHA {cid}: {str(e)[:100]}')
        if i % 25 == 0:
            print(f'  progresso: {i}/{len(trabalhos)} (ok={ok}, falhas={falhas})')
    print(f'\nConcluído: {ok} curadorias atualizadas, {falhas} falhas, {embutidos} embeddings gerados.')
    return 0 if falhas == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
