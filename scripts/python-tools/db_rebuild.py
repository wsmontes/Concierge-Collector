#!/usr/bin/env python3
"""
File: db_rebuild.py
Purpose: Reconstrução do MongoDB após estouro de cota (incidente 2026-08-12):
         exporta TUDO em BSON local, apaga as coleções e repopula com
         embeddings compactados (Binary float32 — ~6KB/vetor em vez de ~20KB).
         Aprovado pelo usuário ("baixa tudo, apaga os dados e repopula corretamente").
Dependencies: pymongo, bson (venv de concierge-api-v3)
Usage:
  python3 db_rebuild.py export   # grava data/backups/full-dump-2026-08-12/<coll>.bson
  python3 db_rebuild.py verify   # confere o dump antes de apagar
  python3 db_rebuild.py wipe     # apaga TODAS as coleções do banco
  python3 db_rebuild.py restore  # reinsere do dump com embeddings compactados
"""
import os
import struct
import sys
from datetime import datetime, timezone

import pymongo
from bson import Binary, BSON

DUMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'backups', 'full-dump-2026-08-12')


def load_env():
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'concierge-api-v3', '.env')
    with open(env) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k, v.strip().strip('"'))


def connect():
    load_env()
    client = pymongo.MongoClient(os.environ['MONGODB_URL'], serverSelectionTimeoutMS=20000)
    db = client[os.environ.get('MONGODB_DB_NAME', 'concierge-collector')]
    client.admin.command('ping')
    return client, db


def write_bson_stream(path, docs_iter):
    with open(path, 'wb') as f:
        for doc in docs_iter:
            raw = BSON.encode(doc)
            f.write(struct.pack('<i', len(raw)))
            f.write(raw)


def read_bson_stream(path):
    with open(path, 'rb') as f:
        while True:
            hdr = f.read(4)
            if not hdr:
                break
            (size,) = struct.unpack('<i', hdr)
            yield BSON(f.read(size)).decode()


def compact_embeddings(cur):
    """Converte vetores double→Binary float32 na hora de reinserir."""
    embs = cur.get('embeddings')
    if not embs:
        return cur
    new = []
    for emb in embs:
        v = emb.get('vector')
        if isinstance(v, bytes):
            new.append(emb)
        else:
            arr = [float(x) for x in v]
            new.append({**emb, 'vector': Binary(struct.pack('<%df' % len(arr), *arr), subtype=0)})
    return {**cur, 'embeddings': new}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    os.makedirs(DUMP_DIR, exist_ok=True)
    client, db = connect()
    colls = sorted(db.list_collection_names())

    if mode == 'export':
        for coll in colls:
            path = os.path.join(DUMP_DIR, f'{coll}.bson')
            write_bson_stream(path, db[coll].find({}))
            print(f'{coll}: {os.path.getsize(path)//1024} KB exportados')
        print('EXPORT OK')
        return 0

    if mode == 'verify':
        ok = True
        for coll in colls:
            path = os.path.join(DUMP_DIR, f'{coll}.bson')
            if not os.path.isfile(path):
                print(f'FALTA {coll}.bson')
                ok = False
                continue
            n = sum(1 for _ in read_bson_stream(path))
            live = db[coll].count_documents({})
            status = 'OK' if n == live else f'DIVERGE (dump={n} live={live})'
            if n != live:
                ok = False
            print(f'{coll}: dump={n} live={live} {status}')
        print('VERIFY OK' if ok else 'VERIFY FALHOU')
        return 0 if ok else 1

    if mode == 'wipe':
        for coll in colls:
            db[coll].drop()
            print(f'{coll}: dropada')
        print('WIPE OK')
        return 0

    if mode == 'restore':
        # Lista do DIRETÓRIO do dump (o banco pode estar vazio pós-wipe)
        colls = sorted(f[:-5] for f in os.listdir(DUMP_DIR) if f.endswith('.bson'))
        restored = 0
        for coll in colls:
            path = os.path.join(DUMP_DIR, f'{coll}.bson')
            docs = []
            for doc in read_bson_stream(path):
                if coll == 'curations':
                    doc = compact_embeddings(doc)
                docs.append(doc)
                if len(docs) >= 200:
                    db[coll].insert_many(docs)
                    restored += len(docs)
                    docs = []
            if docs:
                db[coll].insert_many(docs)
                restored += len(docs)
            print(f'{coll}: {restored} docs reinseridos')
            restored = 0
        print('RESTORE OK')
        print(f'Total por coleção: { {c: db[c].count_documents({}) for c in colls} }')
        return 0

    print(f'Modo desconhecido: {mode} (export|verify|wipe|restore)')
    return 1


if __name__ == '__main__':
    sys.exit(main())
