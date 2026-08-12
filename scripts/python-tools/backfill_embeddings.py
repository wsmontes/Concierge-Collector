#!/usr/bin/env python3
"""
File: backfill_embeddings.py
Purpose: Backfill de embeddings OpenAI (text-embedding-3-small, 1536d) para curadorias sem
         embeddings — direto no MongoDB (como o resto do pipeline), para que semantic-search
         e hybrid-search cubram ~100% das curadorias. Aprovado pelo usuário em 2026-08-12.
Dependencies: pymongo, openai (venv de concierge-api-v3)
Usage:
  python3 backfill_embeddings.py dry-run   # conta textos e estima custo, sem escrever
  python3 backfill_embeddings.py go        # executa o backfill
"""
import os
import sys
import time
from datetime import datetime, timezone

import pymongo
from openai import OpenAI

EMBEDDING_MODEL = 'text-embedding-3-small'
EMBEDDING_DIMENSIONS = 1536
OPENAI_BATCH = 100  # textos por chamada
DELAY_BETWEEN_BATCHES = 1.0
PRICE_PER_1M_TOKENS = 0.02  # USD, text-embedding-3-small


def load_env():
    """Carrega variáveis do .env SEM o shell sobrescrever — o perfil do usuário exporta
    OPENAI_BASE_URL=http://localhost:1234/v1 (LM Studio) e OPENAI_API_KEY=lm-studio,
    que sequestram o SDK da OpenAI. Aqui o .env TEM precedência."""
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'concierge-api-v3', '.env')
    with open(env) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ[k] = v.strip().strip('"')  # sobrescreve o shell propositalmente
    # Garante que a chamada vá para a API real da OpenAI (não LM Studio local)
    os.environ.pop('OPENAI_BASE_URL', None)
    os.environ.pop('OPENAI_MODEL', None)


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


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'dry-run'
    load_env()
    client = pymongo.MongoClient(os.environ['MONGODB_URL'], serverSelectionTimeoutMS=15000)
    db = client[os.environ.get('MONGODB_DB_NAME', 'concierge-collector')]
    oai = OpenAI(api_key=os.environ['OPENAI_API_KEY'], base_url='https://api.openai.com/v1')

    filtro = {'$or': [{'embeddings': {'$exists': False}}, {'embeddings': []}],
              'status': {'$ne': 'deleted'}}
    curations = list(db.curations.find(filtro, {'_id': 1, 'categories': 1}))
    sem_textos = []
    trabalhos = []  # (curation_id, texts, meta)
    total_textos = 0
    for c in curations:
        texts, meta = curation_texts(c)
        if not texts:
            sem_textos.append(str(c['_id']))
            continue
        trabalhos.append((str(c['_id']), texts, meta))
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
            embeddings = []
            for m in meta:
                if m['text'] in vectors:
                    embeddings.append({'text': m['text'], 'category': m['category'],
                                       'concept': m['concept'], 'vector': vectors[m['text']]})
            if not embeddings:
                falhas += 1
                continue
            db.curations.update_one({'_id': cid}, {'$set': {
                'embeddings': embeddings,
                'embeddings_metadata': {
                    'model': EMBEDDING_MODEL,
                    'dimensions': EMBEDDING_DIMENSIONS,
                    'total_embeddings': len(embeddings),
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'backfilled': True,
                },
            }})
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
