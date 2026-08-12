#!/usr/bin/env python3
"""
File: prod_smoke.py
Purpose: Smoke test read-only dos endpoints GET da API de produção (Render),
         com retry em 404 transitório e captura de headers para diagnóstico.
Dependencies: pymongo (para ids de exemplo reais), stdlib urllib.
Usage: python3 prod_smoke.py [--base https://concierge-collector.onrender.com]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = 'https://concierge-collector.onrender.com'
UA = {'User-Agent': 'curl/8.7.1', 'Accept': 'application/json'}


def load_env(paths=('concierge-api-v3/.env', '.env')):
    """Carrega .env linha a linha (não usar `set -a; . .env` no shell — não exporta)."""
    for p in paths:
        if not os.path.isfile(p):
            continue
        with open(p) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v.strip().strip('"'))


def hit(url, timeout=15):
    """GET retornando (status, body_truncado, headers_importantes)."""
    try:
        req = urllib.request.Request(url, method='GET', headers=dict(UA))
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(160).decode('utf8', 'replace').replace('\n', ' '), {
                'rndr-id': r.headers.get('rndr-id'),
                'cf-cache-status': r.headers.get('cf-cache-status'),
            }
    except urllib.error.HTTPError as e:
        return e.code, e.read(160).decode('utf8', 'replace').replace('\n', ' '), {
            'rndr-id': e.headers.get('rndr-id'),
            'cf-cache-status': e.headers.get('cf-cache-status'),
            'server': e.headers.get('server'),
        }
    except Exception as e:
        return 'ERR', '', {'erro': str(e)[:120]}


def hit_retry(url, retries=1, delay=2):
    """Retry em 404 para absorver falhas transitórias reais (rede/edge)."""
    code, body, hdrs = hit(url)
    if code == 404 and retries > 0:
        time.sleep(delay)
        code2, body2, hdrs2 = hit(url)
        if code2 != 404:
            return code2, body2, hdrs2, f'instável (404→{code2})'
    return code, body, hdrs, ''


def sample_ids():
    try:
        import pymongo
    except ImportError:
        return {}
    client = pymongo.MongoClient(os.environ.get('MONGODB_URL', ''), serverSelectionTimeoutMS=8000)
    db = client[os.environ.get('MONGODB_DB_NAME', 'concierge-collector')]
    out = {}
    for coll, key in (('entities', 'entity_id'), ('curations', 'curation_id'),
                      ('curators', 'curator_id'), ('ai_concepts', 'concept_id')):
        doc = db[coll].find_one({}, {'_id': 1})
        if doc:
            out[key] = str(doc['_id'])
    return out


def main():
    load_env()
    samples = sample_ids()
    spec = json.loads(urllib.request.urlopen(
        urllib.request.Request(f'{BASE}/api/v3/openapi.json', headers=UA), timeout=30).read())
    gets = sorted(p for p, ops in spec['paths'].items() if 'get' in ops)
    ok = warn = fail = 0
    print(f'== PROD SMOKE — {len(gets)} rotas GET em {BASE} ==')
    for p in gets:
        if '{' in p:
            p2 = p
            for key, val in samples.items():
                p2 = p2.replace('{' + key + '}', val)
            p2 = p2.replace('{capture_id}', 'sessao-inexistente')
            if '{' in p2:
                print(f'skip   {p}')
                continue
        else:
            p2 = p
        # ATENÇÃO: os paths do openapi.json JÁ incluem o prefixo /api/v3 — não prefixar de novo
        code, body, hdrs, note = hit_retry(f'{BASE}{p2}')
        if code == 'ERR' or str(code).startswith('5'):
            fail += 1
        elif str(code).startswith('4'):
            warn += 1
        else:
            ok += 1
        flag = ' <-- ATENCAO' if (code == 'ERR' or str(code).startswith('5')) else ''
        extra = f' {hdrs}' if (code == 'ERR' or str(code).startswith('5')) else ''
        print(f'{code!s:6} {p:55} {body[:90]}{flag}{extra} {note}')
    print(f'\nresumo: ok={ok} 4xx={warn} 5xx/ERR={fail}')
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
