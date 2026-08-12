#!/usr/bin/env python3
"""
File: data_cleanup.py
Purpose: Backup e limpeza de dados de teste/órfãos do MongoDB (aprovado pelo usuário em 2026-08-12).
Dependencies: pymongo, bson (venv de concierge-api-v3)
Usage:
  python3 data_cleanup.py backup     # exporta tudo que seria deletado para data/backups/
  python3 data_cleanup.py execute    # executa a limpeza (exige backup verificado antes)
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

import pymongo
from bson import json_util

BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'backups')
BACKUP_FILE = os.path.join(BACKUP_DIR, 'cleanup-2026-08-12.json')


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
    client = pymongo.MongoClient(os.environ['MONGODB_URL'], serverSelectionTimeoutMS=15000)
    db = client[os.environ.get('MONGODB_DB_NAME', 'concierge-collector')]
    client.admin.command('ping')
    return client, db


def to_json(docs):
    return json_util.loads(json_util.dumps(docs))


def collect(db):
    eids = set(str(x['_id']) for x in db.entities.find({}, {'_id': 1}))
    orphan_ids = [str(c['_id']) for c in db.curations.find({'entity_id': {'$exists': True, '$ne': None}}, {'_id': 1, 'entity_id': 1})
                  if str(c['entity_id']) not in eids]
    test_cur = [str(c['_id']) for c in db.curations.find(
        {'createdBy': {'$in': ['test_curator', 'test-curator-123']}}, {'_id': 1})]
    deleted = [str(c['_id']) for c in db.curations.find({'status': 'deleted'}, {'_id': 1})]
    cur_ids = set(orphan_ids) | set(test_cur) | set(deleted)
    cur_docs = to_json(list(db.curations.find({'_id': {'$in': sorted(cur_ids)}})))

    ent_filter = {'$or': [
        {'name': {'$in': ['Restaurant for Curation', 'Merge Test', 'Status Test']}},
        {'name': re.compile(r'^teste', re.I)},
        {'entity_id': re.compile(r'^(rest_teste|entity_merge|entity_status|ent_audit|ent_doc|entity_curation_test)')},
    ]}
    candidates = list(db.entities.find(ent_filter, {'_id': 1, 'entity_id': 1, 'name': 1}))
    staying_refs = {str(c['entity_id']) for c in db.curations.find(
        {'entity_id': {'$exists': True, '$ne': None}}, {'entity_id': 1}) if str(c['_id']) not in cur_ids}
    ent_ids, skipped = [], []
    for e in candidates:
        refs = {str(e['_id'])}
        if e.get('entity_id'):
            refs.add(e['entity_id'])
        if refs & staying_refs:
            skipped.append(f"{e.get('name')} ({e.get('entity_id')})")
        else:
            ent_ids.append(e['_id'])
    ent_docs = to_json(list(db.entities.find({'_id': {'$in': ent_ids}})))

    user_docs = to_json(list(db.users.find({'email': re.compile(r'audit')})))
    cats_fix = to_json(list(db.categories.find({'active': {'$type': 'string'}})))

    plan = {
        'curations': cur_docs,
        'entities': ent_docs,
        'users': user_docs,
        'categories_active_as_string': cats_fix,
    }
    return plan, skipped


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'backup'
    client, db = connect()
    plan, skipped = collect(db)

    print(f'== PLANO DE LIMPEZA ({db.name}) ==')
    print(f"  curadorias a deletar: {len(plan['curations'])}")
    print(f"  entities a deletar:   {len(plan['entities'])}")
    print(f"  users audit a deletar:{len(plan['users'])}")
    print(f"  categories 'active' string -> boolean: {len(plan['categories_active_as_string'])}")
    if skipped:
        print('  entidades PULADAS (referenciadas por curation viva):')
        for s in skipped:
            print('    -', s)

    if mode == 'backup':
        os.makedirs(BACKUP_DIR, exist_ok=True)
        payload = {
            'backup_created_at': datetime.now(timezone.utc).isoformat(),
            'source_db': db.name,
            'reason': 'Limpeza aprovada 2026-08-12: dados de teste, curadorias órfãs e soft-deleted',
            'counts': {k: len(v) for k, v in plan.items()},
            'docs': plan,
        }
        with open(BACKUP_FILE, 'w') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
        print(f'\nBackup gravado em {BACKUP_FILE} ({os.path.getsize(BACKUP_FILE)} bytes)')
        return 0

    if mode == 'execute':
        if not os.path.isfile(BACKUP_FILE):
            print(f'ERRO: backup não encontrado em {BACKUP_FILE} — rode "backup" antes.')
            return 1
        with open(BACKUP_FILE) as f:
            saved = json.load(f)
        for k in ('curations', 'entities', 'users', 'categories_active_as_string'):
            if len(saved['docs'][k]) != len(plan[k]):
                print(f'ERRO: contagem divergente em "{k}" (backup {len(saved["docs"][k])} vs atual {len(plan[k])}). Abortando.')
                return 1
        r = db.curations.delete_many({'_id': {'$in': [d['_id'] for d in plan['curations']]}})
        print(f'curadorias deletadas: {r.deleted_count}')
        r = db.entities.delete_many({'_id': {'$in': [d['_id'] for d in plan['entities']]}})
        print(f'entities deletadas: {r.deleted_count}')
        r = db.users.delete_many({'_id': {'$in': [d['_id'] for d in plan['users']]}})
        print(f'users audit deletados: {r.deleted_count}')
        n = 0
        for c in db.categories.find({'active': {'$type': 'string'}}, {'_id': 1}):
            db.categories.update_one({'_id': c['_id']}, {'$set': {'active': True}})
            n += 1
        print(f"categories corrigidas ('active' -> boolean): {n}")
        print('\nContagens finais:')
        for coll in ('curations', 'entities', 'users', 'categories'):
            print(f'  {coll}: {db[coll].count_documents({})}')
        return 0

    print(f'ERRO: modo desconhecido "{mode}" (use backup|execute)')
    return 1


if __name__ == '__main__':
    sys.exit(main())
