#!/usr/bin/env python3
"""
File: enrich_display_media.py
Purpose: Backfill do `display_media` das Entities — o hero do card. A imagem do
         card deixou de ser descoberta a cada render e passou a ser um FATO
         persistido no documento da Entity (``app/services/display_media_service.py``,
         ``resolve_display_media``). Sem backfill, o acervo (~21.600 Entities)
         nasce sem o campo: o contador de cobertura fica zerado e a PRIMEIRA
         navegação de cada lista dispara a fila de enriquecimento no pior
         momento — com o container servindo.
Dependencies: pymongo (venv de concierge-api-v3), mongo_tools (mesmo dir) e
         app.services.display_media_service — a ÚNICA coisa que escreve o campo.
Why the service (e não uma resolução própria): a descoberta tem ranking, prova
         da referência durável ANTES de gravar e a guarda de segredo — nenhuma
         URL com `?key=` é persistida nem logada. Uma segunda implementação aqui
         seria uma segunda descoberta, e a segunda é justamente a que vaza.
Usage:
  # só conta as candidatas (read-only)
  ./concierge-api-v3/venv/bin/python scripts/python-tools/enrich_display_media.py --dry-run
  # resolve as próximas 200
  ./concierge-api-v3/venv/bin/python scripts/python-tools/enrich_display_media.py --limit 200
  # acervo inteiro (fora de um banco *-test, exige --yes)
  ./concierge-api-v3/venv/bin/python scripts/python-tools/enrich_display_media.py --yes
Guard: `--yes` é obrigatório quando o banco NÃO termina em "-test"; `--dry-run`
         não escreve e por isso nunca pede confirmação.
Resumível: a Entity que já tem fato fresco não volta a ser candidata — o filtro
         é lido do PRÓPRIO documento —, então interromper e rodar de novo
         continua de onde parou, sem arquivo de estado.
Escrita: este script NUNCA escreve no banco; quem grava `display_media` é o
         serviço, que só toca esse campo.
"""
import argparse
import asyncio
import itertools
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional

import mongo_tools

logger = logging.getLogger("enrich_display_media")

DEFAULT_BATCH_SIZE = 25
DRY_RUN_PREVIEW = 5

# A projeção é exatamente o que a resolução LÊ: os cinco caminhos da cadeia
# tolerante de `extract_image_sources`, o fato persistido e a identidade para o
# log. Sem ela cada passe arrastaria o `data` inteiro de ~21.600 documentos
# (fotos, reviews, endereço) só para jogar fora.
PROJECTION = {
    "_id": 1,
    "entity_id": 1,
    "display_media": 1,
    "data.contact.website": 1,
    "data.contacts.website": 1,
    "data.website": 1,
    "data.place_id": 1,
    "data.google_place_id": 1,
}

# Por que uma Entity foi pulada na varredura. O valor é também o nome do
# contador no resumo — um vocabulário só.
SKIP_NO_SOURCE = "sem_fonte"
SKIP_FRESH = "fresco"

# `failed` não é um número só. O serviço PROVA a referência durável antes de
# gravar `resolved` (busca a referência e só então decide), então uma Entity com
# imagem encontrada AINDA termina em `failed` quando o vencedor não tem
# referência persistível (URL assinada, `no_reference`) ou quando a referência
# não serviu agora (os códigos que o serviço já trata como referência morta,
# `DEAD_REFERENCE_ERRORS`). Isso é resultado ESPERADO do desenho, não defeito do
# backfill — e o operador precisa ver isso separado de "não havia imagem".
FAILED_SEM_IMAGEM = frozenset({"no_image_found", "resolution_failed"})
FAILED_IMAGEM_RECUSADA = frozenset({"no_reference"})
# Código que existe nos DOIS caminhos (`blocked_source` é a guarda de SSRF na
# descoberta e na prova): fica só na lista por código, sem bucket.

EPILOG = """\
GUARDA DE BANCO
  O passe GRAVA `display_media` no documento da Entity. O alvo vem do
  MONGODB_DB_NAME do .env de concierge-api-v3 (um MONGODB_URL obsoleto no shell
  não retargeta este script). Quando esse nome NÃO termina em "-test", a escrita
  exige --yes: sem ele o script aborta com código 2 ANTES de conectar. --dry-run
  nunca escreve e por isso nunca pede confirmação.

SEGURANÇA
  Nenhuma URL com `?key=` é persistida nem logada. A referência durável (URL sem
  query ou referência opaca do Places) é gravada pelo serviço; este script não
  monta URL, não chama o Google e não loga website nem place_id — o log por
  linha tem entity, estado, tipo, código de erro e duração, nada mais.

RESUMÍVEL
  A Entity que já tem fato fresco não é candidata de novo, então Ctrl+C e rodar
  de novo continua de onde parou. `--limit N` processa no máximo N candidatas
  por passe (as Entities frescas do caminho não consomem o limite).
"""


def _service():
    """O serviço do display media, importado SOB DEMANDA.

    Import tardio de propósito: `app.core.config.settings` exige MONGODB_URL no
    ambiente no momento em que é construído, e importar este arquivo (os testes
    importam) não pode depender de .env nem escrever no ambiente do processo. Em
    `main()` o .env já foi carregado quando esta chamada acontece.
    """
    from app.services import display_media_service

    return display_media_service


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _log_line(log, entity: str, state: str, kind: str = "-", erro: str = "-", ms: Optional[int] = None) -> None:
    """A ÚNICA forma de log da ferramenta.

    entity, estado, tipo, código de erro e duração — nunca website, place_id ou
    chave (`?key=`). Uma função só para que a garantia não dependa de disciplina
    de quem chama.
    """
    sufixo = f" ms={ms}" if ms is not None else ""
    log(f"enrich display media: entity={entity} state={state} kind={kind} erro={erro}{sufixo}")


def _duracao(segundos: float) -> str:
    if segundos < 60:
        return f"{segundos:.1f}s"
    minutos, resto = divmod(int(segundos), 60)
    horas, minutos = divmod(minutos, 60)
    return f"{horas}h {minutos}m {resto}s" if horas else f"{minutos}m {resto}s"


def skip_reason(doc: dict, *, service=None, now: Optional[datetime] = None) -> Optional[str]:
    """Por que a Entity foi PULADA, ou None quando ela é candidata.

    Espelha a leitura do card (`read_hero_media`): o fato só serve quando a fonte
    não mudou E o prazo não venceu. O leitor do fato é o do SERVIÇO (`_stored`):
    uma segunda interpretação de `expires_at` divergiria na primeira mudança — e
    um fato "fresco" para a ferramenta e "vencido" para o card (ou o contrário)
    é exatamente o defeito silencioso que este backfill existe para evitar.

    `now` é injetável para o teste não depender do relógio.
    """
    service = service or _service()
    now = now or _now()
    website, place_id = service.extract_image_sources(doc)

    if not website and not place_id:
        # Sem fonte de imagem não há o que resolver: a leitura do card também
        # não enfileira nada para estas (o fato terminal delas é `no_sources`).
        return SKIP_NO_SOURCE

    stored = service._stored(doc)
    if stored is None:
        # Sem fato gravado (ou com estado desconhecido): é a candidata típica
        # deste backfill — o acervo inteiro nasceu sem o campo.
        return None

    if stored.get("source_fingerprint") != service.source_fingerprint(website, place_id):
        # O fato fala de outro website/place: a fonte mudou depois de ele ser
        # gravado. Para a leitura do card isso volta a pendente, então aqui volta
        # a ser candidato.
        return None

    expires_at = stored["expires_at"]
    if expires_at is not None and expires_at > now:
        # `failed` dentro da janela de retry e `resolved` dentro do TTL ficam
        # como estão: re-resolver é trabalho jogado fora (e, no caso do
        # `failed`, bateria no provedor que acabou de falhar).
        return SKIP_FRESH

    # Vencido (ou sem prazo): a leitura do card também o descartaria.
    return None


def scan(
    collection,
    *,
    service=None,
    now: Optional[datetime] = None,
    limit: Optional[int] = None,
    resumo: Optional[Dict[str, Any]] = None,
) -> Iterator[dict]:
    """Gera as Entities candidatas, na ordem de `_id`, contando o que pulou.

    Query VAZIA de propósito. Empurrar um pré-filtro MQL "tem website?" para o
    banco criaria uma SEGUNDA lista de caminhos de fonte: no dia em que a API
    aceitasse um caminho novo, o backfill pularia essas Entities em silêncio — a
    mesma classe do skip silencioso que já custou caro aqui. O banco faz o que
    faz bem (varrer e devolver projetado); quem decide se há fonte é o dono da
    decisão, `extract_image_sources`.

    Nenhum índice novo é criado: é uma varredura sequencial por `_id`, e o passe
    inteiro leva horas de rede de qualquer forma.
    """
    service = service or _service()
    now = now or _now()
    contadores = resumo if resumo is not None else {}
    for chave in ("varridas", SKIP_NO_SOURCE, SKIP_FRESH, "candidatas"):
        contadores.setdefault(chave, 0)

    for doc in collection.find({}, PROJECTION).sort([("_id", 1)]):
        contadores["varridas"] += 1
        motivo = skip_reason(doc, service=service, now=now)
        if motivo is not None:
            contadores[motivo] += 1
            continue
        contadores["candidatas"] += 1
        yield doc
        if limit is not None and contadores["candidatas"] >= limit:
            return


async def run_pass(
    db,
    *,
    service=None,
    dry_run: bool = False,
    limit: Optional[int] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    now: Optional[datetime] = None,
    log=None,
) -> Dict[str, Any]:
    """Um passe do backfill: seleciona, resolve em lotes SEQUENCIAIS e resume.

    O resumo é DEVOLVIDO (não só impresso) para o teste medir números em vez de
    stdout, e para um chamador futuro (ops, dashboard) reusar sem o parser.
    """
    service = service or _service()
    log = log or logger.info
    now = now or _now()
    collection = db.entities
    started = time.monotonic()

    resumo: Dict[str, Any] = {
        "dry_run": dry_run,
        "varridas": 0,
        "sem_fonte": 0,
        SKIP_FRESH: 0,
        "candidatas": 0,
        "processadas": 0,
        "resolved": 0,
        "no_sources": 0,
        "failed": 0,
        "failed_por_erro": {},
        "failed_sem_imagem": 0,
        "failed_imagem_recusada": 0,
        "outros": 0,
        "sem_id": 0,
        "exemplos": [],
    }

    candidatas = scan(collection, service=service, now=now, limit=limit, resumo=resumo)

    if dry_run:
        # A varredura é read-only: o dry-run a DRAINA inteira (a resposta que o
        # operador quer é "quantas Entities este backfill tem pela frente?"), sem
        # chamar a resolução uma única vez.
        for doc in candidatas:
            if len(resumo["exemplos"]) < DRY_RUN_PREVIEW:
                resumo["exemplos"].append(service.entity_key(doc))
        resumo["segundos"] = time.monotonic() - started
        return resumo

    while True:
        # Lote sequencial: uma resolução por vez (cada uma toca rede: HTML do
        # site e/ou Places). `batch_size` limita o que fica materializado e dá o
        # ponto de progresso.
        lote = list(itertools.islice(candidatas, batch_size))
        if not lote:
            break
        for doc in lote:
            key = service.entity_key(doc)
            if doc.get("_id") is None:
                # Sem `_id` não há chave de escrita nem de log: o serviço devolve
                # o valor sem persistir, então esta Entity é pulada COM contagem.
                resumo["sem_id"] += 1
                _log_line(log, key, "skipped", erro="sem_id")
                continue
            inicio = time.monotonic()
            try:
                value = await service.resolve_display_media(collection, doc)
            except (KeyboardInterrupt, asyncio.CancelledError):
                raise
            except Exception as exc:
                # Uma resolução que estoura não pode derrubar o passe: a Entity
                # fica sem fato e volta na próxima execução. Só o TIPO do erro
                # entra no log — a mensagem pode carregar URL de fonte.
                resumo["failed"] += 1
                nome = type(exc).__name__
                resumo["failed_por_erro"][nome] = resumo["failed_por_erro"].get(nome, 0) + 1
                _log_line(log, key, "failed", erro=nome, ms=_ms(inicio))
                continue

            state = value.get("state")
            if state == service.STATE_RESOLVED:
                resumo["resolved"] += 1
            elif state == service.STATE_NO_SOURCES:
                resumo["no_sources"] += 1
            elif state == service.STATE_FAILED:
                resumo["failed"] += 1
                codigo = value.get("last_error") or "sem_codigo"
                resumo["failed_por_erro"][codigo] = resumo["failed_por_erro"].get(codigo, 0) + 1
                if codigo in FAILED_SEM_IMAGEM:
                    resumo["failed_sem_imagem"] += 1
                elif codigo in FAILED_IMAGEM_RECUSADA or codigo in service.DEAD_REFERENCE_ERRORS:
                    resumo["failed_imagem_recusada"] += 1
            else:
                resumo["outros"] += 1
            resumo["processadas"] += 1
            _log_line(
                log,
                key,
                state or "-",
                value.get("kind") or "-",
                value.get("last_error") or "-",
                _ms(inicio),
            )
        _log_line(
            log,
            "-",
            "lote",
            erro=f"processadas={resumo['processadas']} resolved={resumo['resolved']} "
            f"no_sources={resumo['no_sources']} failed={resumo['failed']}",
        )

    resumo["segundos"] = time.monotonic() - started
    return resumo


def format_summary(resumo: Dict[str, Any], db_name: str) -> List[str]:
    """O resumo que o operador lê (e que o teste confere por números)."""
    puladas = resumo[SKIP_NO_SOURCE] + resumo[SKIP_FRESH]
    linhas = [
        f"== BACKFILL display_media ({db_name}) ==",
        f"  varridas:            {resumo['varridas']}",
        f"  puladas:             {puladas}"
        f"  (sem fonte de imagem: {resumo[SKIP_NO_SOURCE]} | fato fresco: {resumo[SKIP_FRESH]})",
        f"  candidatas:          {resumo['candidatas']}",
    ]
    if resumo["dry_run"]:
        if resumo["exemplos"]:
            linhas.append(f"  exemplos:            {', '.join(resumo['exemplos'])}")
        linhas.append("  dry-run: nada foi escrito (rode sem --dry-run para resolver).")
    else:
        linhas.append(f"  processadas:         {resumo['processadas']}")
        linhas.append(f"    resolved:          {resumo['resolved']}")
        linhas.append(f"    no_sources:        {resumo['no_sources']}")
        linhas.append(
            f"    failed:            {resumo['failed']}"
            f"  (sem imagem: {resumo['failed_sem_imagem']} |"
            f" imagem achada com referência recusada: {resumo['failed_imagem_recusada']})"
        )
        por_codigo = ", ".join(
            f"{codigo}={total}"
            for codigo, total in sorted(resumo["failed_por_erro"].items(), key=lambda kv: (-kv[1], kv[0]))
        )
        if por_codigo:
            linhas.append(f"      por código:      {por_codigo}")
        if resumo["outros"]:
            linhas.append(f"    outros:            {resumo['outros']}")
        if resumo["sem_id"]:
            linhas.append(f"  sem _id:             {resumo['sem_id']}")
    linhas.append(f"  tempo total:         {_duracao(resumo['segundos'])}")
    return linhas


def require_confirmation(db_name: str, *, confirmed: bool, dry_run: bool) -> None:
    """Guarda de escrita: este passe grava ~21.600 documentos, então fora de um
    banco cujo nome termina em "-test" ele exige `--yes`.

    `--dry-run` não escreve e por isso passa sem confirmação. Levanta ValueError
    (como o wipe/restore de db_rebuild) para que o chamador decida o destino da
    mensagem — e para que a decisão seja testável sem subprocess.
    """
    if dry_run or confirmed:
        return
    if str(db_name).endswith("-test"):
        return
    raise ValueError(
        f"banco '{db_name}' não termina em '-test' e este passe ESCREVE "
        "`display_media` no documento de cada Entity resolvida. Confira o alvo "
        "acima e rode com --yes (ou use --dry-run, que só conta)."
    )


def _positivo(valor: str) -> int:
    numero = int(valor)
    if numero < 1:
        raise argparse.ArgumentTypeError("precisa ser >= 1")
    return numero


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill do `display_media` (hero do card) das Entities.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--limit",
        type=_positivo,
        default=None,
        metavar="N",
        help="no máximo N Entities CANDIDATAS neste passe (default: sem limite).",
    )
    parser.add_argument(
        "--batch-size",
        type=_positivo,
        default=DEFAULT_BATCH_SIZE,
        dest="batch_size",
        metavar="N",
        help=f"Entities por lote sequencial (default: {DEFAULT_BATCH_SIZE}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        dest="dry_run",
        help="seleciona e conta as candidatas sem escrever nada (não exige --yes).",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="confirma a escrita em banco cujo nome NÃO termina em '-test' (ver GUARDA DE BANCO).",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    # Política de precedência declarada em mongo_tools.load_env: um backfill não
    # pode ser retargetado por um MONGODB_URL obsoleto no shell. Fica AQUI, e não
    # no topo do módulo: importar este arquivo (os testes importam) não pode
    # escrever a connection string do .env no ambiente do processo.
    mongo_tools.load_env(always_env=("MONGODB_URL", "MONGODB_DB_NAME"))

    if not os.environ.get("MONGODB_URL"):
        print("ABORTADO: MONGODB_URL ausente (.env de concierge-api-v3 ou shell).", file=sys.stderr)
        return 2

    db_name = os.environ.get("MONGODB_DB_NAME") or mongo_tools.DEFAULT_DB_NAME
    try:
        # Antes de conectar: recusar depois de abrir conexão seria abrir conexão
        # em produção a troco de nada.
        require_confirmation(db_name, confirmed=args.yes, dry_run=args.dry_run)
    except ValueError as exc:
        print(f"ABORTADO: {exc}", file=sys.stderr)
        return 2

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    client, db = mongo_tools.connect()
    try:
        host = client.address
        print(f"alvo: {db.name} @ {host[0]}:{host[1]} — {_now().isoformat(timespec='seconds')}")
        try:
            resumo = asyncio.run(
                run_pass(db, dry_run=args.dry_run, limit=args.limit, batch_size=args.batch_size)
            )
        except (KeyboardInterrupt, asyncio.CancelledError):
            # Interromper é seguro: o que já foi resolvido ficou gravado e a
            # seleção da próxima execução pula tudo que ficou fresco.
            print("\ninterrompido — rode de novo para continuar de onde parou.", file=sys.stderr)
            return 130
        for linha in format_summary(resumo, db.name):
            print(linha)
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
