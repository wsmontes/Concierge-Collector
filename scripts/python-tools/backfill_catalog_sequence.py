#!/usr/bin/env python3
"""
File: backfill_catalog_sequence.py
Purpose: Repõe `catalog_sequence` em curadorias que nasceram antes do mecanismo
         (ou por um importador que grava direto no Mongo, sem passar por
         `ensure_catalog_sequence`). O Admin lista Curations por um SCAN que
         congela o high-water desse campo: sem ele o scan devolve página vazia
         em silêncio e a tela diz que não há nada — enquanto o contador, que não
         usa o campo, soma milhares. Medido em produção (2026-09-15): 1057
         curadorias, 0 com `catalog_sequence`.
Dependencies: pymongo (venv de concierge-api-v3); mongo_tools (mesmo dir)
Usage:
  python3 backfill_catalog_sequence.py            # plano (read-only)
  python3 backfill_catalog_sequence.py --apply    # escreve
Ordering: por `createdAt` ascendente (empate por `_id`), para que os sorts
         "First added"/"Recently added" (sequence_asc/sequence_desc) continuem
         verdadeiros nas linhas legadas — a mais antiga recebe a menor sequência.
"""
import argparse
import os
import sys
from datetime import datetime, timezone

import mongo_tools
from pymongo import UpdateOne

from app.services.catalog_service import (  # noqa: E402  (via sys.path do mongo_tools)
    CATALOG_SEQUENCE_COUNTER_ID,
    reserve_catalog_sequences,
)

MISSING = {"$or": [{"catalog_sequence": {"$exists": False}}, {"catalog_sequence": None}]}


def plan(db):
    """Curadorias sem sequência, na ordem em que vão recebê-la."""
    pendentes = list(
        db.curations.find(MISSING, projection={"curation_id": 1, "createdAt": 1})
        .sort([("createdAt", 1), ("_id", 1)])
    )
    total = db.curations.count_documents({})
    maior = db.curations.find_one(
        {"catalog_sequence": {"$type": "number"}},
        projection={"catalog_sequence": 1},
        sort=[("catalog_sequence", -1)],
    )
    contador = db.counters.find_one({"_id": CATALOG_SEQUENCE_COUNTER_ID}) or {}
    return {
        "pendentes": pendentes,
        "total": total,
        "maior_sequencia": int((maior or {}).get("catalog_sequence", 0)),
        "contador": int(contador.get("value", 0)),
    }


def print_plan(plano, db_name):
    print(f"== BACKFILL catalog_sequence ({db_name}) ==")
    print(f"  curadorias no banco:            {plano['total']}")
    print(f"  sem catalog_sequence:           {len(plano['pendentes'])}")
    print(f"  maior sequência existente:      {plano['maior_sequencia']}")
    print(f"  contador ({CATALOG_SEQUENCE_COUNTER_ID}): {plano['contador']}")
    if plano["pendentes"]:
        primeira = plano["pendentes"][0]
        ultima = plano["pendentes"][-1]
        print(f"  ordem: por createdAt asc — 1ª={primeira.get('curation_id', primeira['_id'])}"
              f" ({primeira.get('createdAt')}) … última={ultima.get('curation_id', ultima['_id'])}"
              f" ({ultima.get('createdAt')})")
        print(f"  sequências a atribuir: {plano['maior_sequencia'] + 1} … "
              f"{plano['maior_sequencia'] + len(plano['pendentes'])}")


def apply_backfill(db, plano):
    pendentes = plano["pendentes"]
    if not pendentes:
        print("nada a fazer.")
        return 0

    # Uma reserva só para o lote inteiro: `reserve_catalog_sequences` faz `$max`
    # no contador antes do `$inc`, então não colide com escrita concorrente da API.
    sequencias = list(reserve_catalog_sequences(db, len(pendentes)))
    operacoes = []
    for documento, sequencia in zip(pendentes, sequencias):
        alvo = {"curation_id": documento["curation_id"]} if "curation_id" in documento else {"_id": documento["_id"]}
        # MESMO predicado do plano: se o write casasse só `$exists: False`, uma
        # linha com `null` explícito seria contada como pendente, receberia
        # sequência reservada e nunca seria escrita — o verify acusaria e repetir
        # o script só gastaria mais sequências.
        operacoes.append(UpdateOne({**alvo, **MISSING}, {"$set": {"catalog_sequence": sequencia}}))
    resultado = db.curations.bulk_write(operacoes, ordered=False)
    print(f"escritas: matched={resultado.matched_count} modified={resultado.modified_count} de {len(operacoes)}")
    if resultado.matched_count != len(operacoes) or resultado.modified_count != len(operacoes):
        print("ERRO: alguma operação não casou exatamente o documento planejado "
              "(o skip silencioso é o defeito que este script existe para consertar).")
        return 1
    return 0


def verify(db):
    faltando = db.curations.count_documents(MISSING)
    total = db.curations.count_documents({"catalog_sequence": {"$type": "number"}})
    distintos = len(db.curations.distinct("catalog_sequence"))
    print("== verificação ==")
    print(f"  ainda sem catalog_sequence: {faltando}")
    print(f"  com sequência:             {total} | valores distintos: {distintos}")
    if faltando or distintos != total:
        print("ERRO: o invariante 'toda curadoria tem sequência única' não fechou.")
        return 1
    print("  invariante fechado: toda curadoria tem sequência, sem repetição.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Repõe catalog_sequence nas curadorias legadas.")
    parser.add_argument("--apply", action="store_true", help="escreve (sem isto, só imprime o plano)")
    args = parser.parse_args()

    # Política de precedência declarada em mongo_tools.load_env: um backfill não
    # pode ser retargetado por um MONGODB_URL obsoleto no shell. Fica AQUI, e não
    # no topo do módulo: importar este arquivo (os testes importam) não pode
    # escrever a connection string do .env no ambiente do processo.
    mongo_tools.load_env(always_env=("MONGODB_URL", "MONGODB_DB_NAME"))

    client, db = mongo_tools.connect()
    try:
        host = client.address
        print(f"alvo: {db.name} @ {host[0]}:{host[1]} — {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
        plano = plan(db)
        print_plan(plano, db.name)
        if not args.apply:
            print("\ndry-run: nada foi escrito. Use --apply para executar.")
            return 0
        codigo = apply_backfill(db, plano)
        if codigo:
            return codigo
        return verify(db)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
