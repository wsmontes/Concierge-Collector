"""
OpenAIService: Interface with OpenAI APIs using MongoDB configuration.

Provides transcription (Whisper), concept extraction (GPT-4), and image analysis (GPT-4 Vision)
using configurations and prompts stored in MongoDB.
"""

import asyncio
import base64
import io
import json
import logging
import re
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

import httpx
from openai import OpenAI
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService

logger = logging.getLogger(__name__)

MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024  # 20MB (max_file_size_mb do config)


# ============================================================================
# SSRF GUARDS (auditoria ago/2026)
# ============================================================================
# resolve_image_input baixava image_url com redirects livres: um usuário
# autenticado podia apontar para 127.0.0.1/10.x/169.254.169.254 e ler a
# rede interna do servidor. Bloqueio por DNS do host + revalidação a cada
# redirect + limite de bytes DURANTE o streaming.


def _is_blocked_host(hostname: str) -> bool:
    """True quando o host resolve para IP interno/reservado (SSRF) ou não
    resolve (não dá para validar → bloqueia)."""
    import ipaddress
    import socket

    if not hostname:
        return True
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return True

    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local  # inclui 169.254.169.254 (metadata cloud)
            or ip.is_reserved
            or ip.is_multicast
        ):
            return True
    return False


def _validate_image_request(request) -> None:
    """Valida o destino de UMA requisição (a inicial e cada redirect).
    Versão síncrona da lógica — use `_validate_image_request_hook` como
    event hook do httpx."""
    import urllib.parse

    parsed = urllib.parse.urlparse(str(request.url))
    if parsed.scheme not in ("http", "https"):
        raise ValueError("image_url precisa ser http(s)")
    if parsed.username or parsed.password:
        raise ValueError("image_url com credenciais embutidas não é permitida")
    if _is_blocked_host(parsed.hostname or ""):
        raise ValueError("destino de imagem não permitido (rede interna)")


async def _validate_image_request_hook(request) -> None:
    """Hook de request do httpx ≥0.28: o client faz `await hook(request)`
    INCONDICIONAL — hook síncrono que retorna None quebra com
    "TypeError: object NoneType can't be used in 'await' expression"
    (regressão do httpx 0.28.1: o download de imagens falhava calado,
    capturado pelo except genérico como "Não foi possível baixar").
    Este wrapper assíncrono preserva a validação síncrona acima."""
    _validate_image_request(request)


def _sniff_image_mime(raw: bytes) -> Optional[str]:
    """Mime por magic bytes — base64 cru não informa o tipo do arquivo."""
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


async def resolve_image_input(image: str) -> str:
    """Normaliza a entrada de imagem para o formato que a OpenAI consegue
    consumir SEM download remoto: data URL (base64).

    URLs http(s) — inclusive as do proxy /places/photo (desde 2026-08-18 o
    proxy devolve os bytes em streaming; antes era 302 → Google, que o
    downloader da OpenAI não seguia e falhava com "Error while downloading
    https://...") — são baixadas AQUI (server-side). Data URLs passam
    direto. Base64 cru (contrato documentado do image_file) é convertido
    para data URL com o mime detectado pelos magic bytes."""
    if isinstance(image, str) and image.startswith("data:"):
        return image

    if not isinstance(image, str):
        raise ValueError(
            "Formato de imagem não suportado — use URL http(s), data URL ou "
            "base64 (o download de imagens é feito pelo servidor)"
        )

    if image.startswith(("http://", "https://")):
        # streaming + limite DURANTE o download + SSRF guard em cada
        # request da cadeia de redirects (event hook)
        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=30, event_hooks={"request": [_validate_image_request_hook]}
            ) as client:
                async with client.stream("GET", image) as response:
                    response.raise_for_status()

                    content_type = response.headers.get("content-type", "")
                    if not content_type.startswith("image/"):
                        raise ValueError(f"content-type inválido na imagem: {content_type!r}")

                    chunks = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_IMAGE_DOWNLOAD_BYTES:
                            raise ValueError(f"Imagem maior que {MAX_IMAGE_DOWNLOAD_BYTES // (1024 * 1024)}MB")
                        chunks.append(chunk)
                    raw = b"".join(chunks)
        except ValueError:
            raise
        except Exception as exc:  # httpx.HTTPError + status != 2xx
            raise ValueError(f"Não foi possível baixar a imagem: {exc}") from exc

        b64 = base64.b64encode(raw).decode()
        return f"data:{content_type};base64,{b64}"

    # base64 cru (ex.: image_file do frontend antigo / clientes externos)
    if re.fullmatch(r"[A-Za-z0-9+/=\s]+", image):
        try:
            raw = base64.b64decode(image, validate=True)
        except Exception as exc:
            raise ValueError(f"image_file base64 inválido: {exc}") from exc
        mime = _sniff_image_mime(raw)
        if not mime:
            raise ValueError(
                "Formato de imagem não reconhecido (magic bytes desconhecidos) — " "use URL http(s) ou data URL"
            )
        return f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    raise ValueError(
        "Formato de imagem não suportado — use URL http(s), data URL ou base64 "
        "(o download de imagens é feito pelo servidor)"
    )


_PRICE_ALIASES = {
    "inexpensive": "unexpensive",
    "cheap": "unexpensive",
    "economical": "unexpensive",
    "moderate": "mid-range",
    "medium": "mid-range",
    "average": "mid-range",
    "pricey": "expensive",
    "high-end": "expensive",
    "luxury": "expensive",
}


def _canonicalize_categories(raw_result: Dict[str, Any], allowed_keys: set) -> Dict[str, list]:
    """Validação dura do resultado da extração (Fase 3 da modernização).

    - Chaves fora do vocabulário são ignoradas (nunca inventar campos)
    - price_range: só aceita unexpensive|mid-range|expensive (aliases
      comuns são mapeados; o primeiro válido vence — "exatamente um")
    - Tags em lowercase como rede de segurança (exceções: menu e
      price_and_payment, que carregam nomes próprios/valores)
    """
    normalized: Dict[str, list] = {}
    for category_key in allowed_keys:
        values = raw_result.get(category_key)
        if not isinstance(values, list):
            continue
        cleaned = []
        for v in values:
            s = str(v).strip()
            if not s:
                continue
            if category_key == "price_range":
                norm = s.lower()
                if norm in ("unexpensive", "mid-range", "expensive"):
                    cleaned.append(norm)
                    break  # exatamente um
                if norm in _PRICE_ALIASES:
                    cleaned.append(_PRICE_ALIASES[norm])
                    break
                continue  # fora do vocabulário: descarta
            if category_key not in ("menu", "price_and_payment"):
                s = s.lower()
            cleaned.append(s)
        if cleaned:
            normalized[category_key] = cleaned
    return normalized


def _clean_restaurant_name(value) -> Optional[str]:
    """Validação do nome extraído (Fase 3): placeholders viram None e
    nomes absurdamente longos (frase inteira em vez de nome) são
    descartados."""
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name or name.lower() in {"unknown", "null", "none", "n/a"}:
        return None
    if len(name) > 100:
        return None
    return name


class OpenAIService:
    """OpenAI service using MongoDB configuration"""

    def __init__(self, api_key: str, db_url: str, db_name: str):
        """
        Initialize OpenAIService.

        Args:
            api_key: OpenAI API key
            db_url: MongoDB connection URL
            db_name: Database name
        """
        self.client = OpenAI(
            api_key=api_key,
            # Fase 4: retries explícitos (exponencial + jitter do SDK) e
            # timeout por chamada — antes dependia só do default do SDK
            max_retries=3,
            timeout=60.0,
        )

        # Create Motor async client for db operations (insert_one, find_one)
        async_client = AsyncIOMotorClient(db_url)
        self.db = async_client[db_name]

        # Create sync PyMongo client for config_service (non-critical reads)
        sync_client = MongoClient(db_url)
        sync_db = sync_client[db_name]

        self.config_service = OpenAIConfigService(sync_db)
        self.category_service = CategoryService(self.db)

    async def transcribe_audio(
        self,
        audio_data: Any,
        language: Optional[str] = None,
        save_to_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        Transcribe audio using Whisper with MongoDB config.

        Args:
            audio_data: Audio file object or base64 string
            language: Language code (overrides config default)
            save_to_cache: Whether to save transcription to ai_transcriptions collection (default: True)

        Returns:
            Dictionary with transcription_id, text, language, model
        """
        # Get service configuration
        config = self.config_service.get_config("transcription")

        # Use config parameters
        model = config["model"]
        params = config["config"].copy()
        if language:
            # Normalize language to ISO-639-1 format (pt-BR → pt)
            normalized_lang = language.split("-")[0].lower()
            params["language"] = normalized_lang

        # Handle base64 audio data conversion
        try:
            if isinstance(audio_data, str):
                logger.debug(f"Received base64 string, length: {len(audio_data)}")
                # Decode base64 string to bytes
                audio_bytes = base64.b64decode(audio_data)
                logger.debug(f"Decoded to {len(audio_bytes)} bytes")
                # Create file-like object
                audio_file = io.BytesIO(audio_bytes)
                audio_file.name = "audio.mp3"  # OpenAI needs filename for format detection
            else:
                # Already a file object
                audio_file = audio_data

            # Call OpenAI — SDK é síncrono; roda em thread para não travar o
            # event loop (1 worker no Render atende TODOS os requests).
            logger.debug(f"Calling OpenAI Whisper API with model: {model}")
            response = await asyncio.to_thread(
                self.client.audio.transcriptions.create,
                model=model,
                file=audio_file,
                **params,
            )
            logger.debug(f"OpenAI response received, text length: {len(response.text)}")
        except Exception as e:
            logger.error(f"Audio transcription failed: {type(e).__name__}: {e}", exc_info=True)
            raise

        transcription_id = f"trans_{uuid.uuid4().hex[:12]}"

        # Cache transcription in DB only if requested
        if save_to_cache:
            await self.db.ai_transcriptions.insert_one(
                {
                    "transcription_id": transcription_id,
                    "text": response.text,
                    "language": params.get("language", "pt-BR"),
                    "model": model,
                    "duration": getattr(response, "duration", None),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return {
            "transcription_id": transcription_id,
            "text": response.text,
            "language": params.get("language", "pt-BR"),
            "model": model,
            "duration": getattr(response, "duration", None),
        }

    async def extract_concepts_from_text(
        self, text: str, entity_type: str = "restaurant", save_to_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Extract concepts from text using GPT-4 with MongoDB config.

        Args:
            text: Text to analyze
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save concepts to ai_concepts collection (default: True)

        Returns:
            Dictionary with concepts, confidence_score, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)

        # Get service configuration
        config = self.config_service.get_config("concept_extraction_text")

        # Render prompt with variables
        prompt = self.config_service.render_prompt("concept_extraction_text", {"text": text, "categories": categories})

        # Call OpenAI — SDK síncrono em thread (ver transcribe_audio).
        # RE-PROMPT único em parse inválido (Fase 3): resposta não-JSON
        # recebe o erro e tenta mais uma vez — máx 2 chamadas por extração.
        raw_result = None
        last_error = None
        for attempt in range(2):
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=config["model"],
                messages=[{"role": "user", "content": prompt}],
                **config["config"],
            )

            # Parse JSON response
            raw_content = (response.choices[0].message.content or "").strip()
            if raw_content.startswith("```"):
                raw_content = raw_content.strip("`")
                if raw_content.startswith("json"):
                    raw_content = raw_content[4:].strip()
            try:
                raw_result = json.loads(raw_content)
                break
            except json.JSONDecodeError as exc:
                last_error = str(exc)
                prompt = (
                    prompt
                    + "\n\nSua resposta anterior não era JSON válido (erro: "
                    + last_error
                    + "). Responda SOMENTE com JSON válido, sem markdown."
                )
        if raw_result is None:
            raise ValueError(f"concept extraction devolveu JSON inválido duas vezes: {last_error}")

        # Normalize to the frontend-compatible shape expected by ConceptModule:
        # {
        #   "concepts": [{"category": "cuisine", "value": "Italian"}, ...],
        #   "categories": {"cuisine": ["Italian"], ...},
        #   "confidence_score": 0.95,
        #   ...metadata
        # }
        allowed_category_keys = set(categories or [])
        normalized_categories: Dict[str, list] = _canonicalize_categories(raw_result, allowed_category_keys)

        # Backward-compat: if model returned a flat concepts list of objects
        if not normalized_categories and isinstance(raw_result.get("concepts"), list):
            concepts_payload = raw_result.get("concepts")
            if concepts_payload and all(isinstance(c, dict) for c in concepts_payload):
                for concept in concepts_payload:
                    category_key = concept.get("category")
                    value = concept.get("value")
                    if not category_key or not value:
                        continue
                    if allowed_category_keys and category_key not in allowed_category_keys:
                        continue
                    normalized_categories.setdefault(category_key, []).append(str(value).strip())

        normalized_concepts = [
            {"category": category_key, "value": value}
            for category_key, values in normalized_categories.items()
            for value in values
        ]

        result = {
            "concepts": normalized_concepts,
            "categories": normalized_categories,
            "restaurant_name": raw_result.get("restaurant_name"),
            "confidence_score": raw_result.get("confidence_score", 0.0),
            "entity_type": entity_type,
            "model": config["model"],
        }

        # Cache concepts in DB only if requested
        if save_to_cache:
            concept_id = f"concept_{uuid.uuid4().hex[:12]}"
            await self.db.ai_concepts.insert_one(
                {
                    "concept_id": concept_id,
                    "text": text,
                    "concepts": normalized_concepts,
                    "categories": normalized_categories,
                    "restaurant_name": result.get("restaurant_name"),
                    "confidence_score": result.get("confidence_score", 0.0),
                    "entity_type": entity_type,
                    "model": config["model"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return result

    async def extract_restaurant_name_from_text(self, text: str, save_to_cache: bool = False) -> Dict[str, Any]:
        """
        Extract restaurant name from text using a dedicated OpenAI config object from MongoDB.

        Args:
            text: Text to analyze
            save_to_cache: Whether to save extraction metadata to ai_concepts collection

        Returns:
            Dictionary with restaurant_name, confidence_score, model, and service
        """
        config_service_name = "restaurant_name_extraction_text"
        config = self.config_service.get_config(config_service_name)

        prompt = self.config_service.render_prompt(config_service_name, {"text": text})

        # Re-prompt único em parse inválido (mesmo padrão da extração de
        # conceitos — Fase 3 da modernização)
        parsed = None
        raw_content = ""
        for attempt in range(2):
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=config["model"],
                messages=[{"role": "user", "content": prompt}],
                **config["config"],
            )
            raw_content = (response.choices[0].message.content or "").strip()
            if raw_content.startswith("```"):
                raw_content = raw_content.strip("`")
                if raw_content.startswith("json"):
                    raw_content = raw_content[4:].strip()
            try:
                parsed = json.loads(raw_content)
                break
            except json.JSONDecodeError:
                prompt = (
                    prompt
                    + "\n\nSua resposta anterior não era JSON válido. "
                    + "Responda SOMENTE com JSON válido, sem markdown."
                )

        restaurant_name = None
        confidence_score = None

        if isinstance(parsed, dict):
            restaurant_name = parsed.get("restaurant_name") or parsed.get("name") or parsed.get("result")
            confidence_score = parsed.get("confidence_score")
        else:
            restaurant_name = raw_content

        restaurant_name = _clean_restaurant_name(restaurant_name)

        result = {
            "restaurant_name": restaurant_name,
            "confidence_score": confidence_score,
            "model": config["model"],
            "service": config_service_name,
        }

        if save_to_cache:
            concept_id = f"concept_{uuid.uuid4().hex[:12]}"
            await self.db.ai_concepts.insert_one(
                {
                    "concept_id": concept_id,
                    "text": text,
                    "restaurant_name": restaurant_name,
                    "confidence_score": confidence_score,
                    "entity_type": "restaurant",
                    "model": config["model"],
                    "service": config_service_name,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return result

    async def analyze_image(
        self,
        image_url: str,
        entity_type: str = "restaurant",
        save_to_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        Analyze image using GPT-4 Vision with MongoDB config.

        Args:
            image_url: URL of image or base64 data
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save analysis to ai_image_analysis collection (default: True)

        Returns:
            Dictionary with concepts, confidence_score, visual_notes, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)

        # Get service configuration
        config = self.config_service.get_config("image_analysis")

        # Render prompt with variables
        prompt = self.config_service.render_prompt("image_analysis", {"categories": categories})

        # Baixar a imagem AQUI e mandar data URL: o downloader da OpenAI não
        # segue o 302 do proxy /places/photo (falha "Error while downloading")
        image_url = await resolve_image_input(image_url)

        # Params da família GPT-5 (modernização ago/2026): `max_tokens` é
        # REJEITADO (usar max_completion_tokens) e `temperature` só aceita
        # o default 1 — omitir quando o config não trouxer. O contrato é
        # lido do config do Mongo (fonte única), não hardcoded por modelo.
        cfg = config["config"]
        completion_kwargs = {}
        if cfg.get("max_completion_tokens") is not None:
            completion_kwargs["max_completion_tokens"] = cfg["max_completion_tokens"]
        else:
            completion_kwargs["max_tokens"] = cfg.get("max_tokens", 300)
        if cfg.get("temperature") is not None:
            completion_kwargs["temperature"] = cfg["temperature"]
        if cfg.get("response_format"):
            completion_kwargs["response_format"] = cfg["response_format"]
        # GPT-5.6 aceita reasoning_effort (none..max) mas o SDK 1.57 não
        # expõe o param — vai via extra_body, declarado no config do Mongo
        if cfg.get("extra_body"):
            completion_kwargs["extra_body"] = cfg["extra_body"]

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            "detail": cfg.get("detail", "high"),
                        },
                    },
                ],
            }
        ]

        # Call OpenAI Vision — SDK síncrono em thread (ver transcribe_audio)
        response = await asyncio.to_thread(
            self.client.chat.completions.create,
            model=config["model"],
            messages=messages,
            **completion_kwargs,
        )

        # Parse JSON response — gpt-4o sem response_format devolve texto solto
        # ou markdown; extrai o primeiro objeto JSON quando possível
        raw_content = (response.choices[0].message.content or "").strip()
        if raw_content.startswith("```"):
            raw_content = raw_content.strip("`")
            if raw_content.startswith("json"):
                raw_content = raw_content[4:].strip()
        try:
            result = json.loads(raw_content)
        except json.JSONDecodeError:
            start, end = raw_content.find("{"), raw_content.rfind("}")
            if start == -1 or end <= start:
                raise ValueError(f"Resposta da análise de imagem não é JSON: {raw_content[:200]!r}")
            result = json.loads(raw_content[start : end + 1])
        result["entity_type"] = entity_type
        result["model"] = config["model"]

        # Chaves de metadados do payload (não são categorias)
        metadata_keys = {
            "confidence_score",
            "entity_type",
            "model",
            "visual_notes",
            "restaurant_name",
        }

        # Caminho de imagem aplica a MESMA validação dura do caminho de
        # texto (2026-08-18): chaves fora do vocabulário (ambiance/design
        # do prompt antigo) e price_range fora da escala fechada não podem
        # vazar para o cache nem para as curadorias via orquestrador.
        allowed = set(categories)
        if allowed:
            normalized = _canonicalize_categories(result, allowed)
            for key in list(result.keys()):
                if key in allowed or key in metadata_keys:
                    continue
                if isinstance(result.get(key), list):
                    result.pop(key, None)  # categoria inventada fora do vocabulário
            result.update(normalized)

        # Cache image analysis in DB only if requested
        if save_to_cache:
            # Extract categories (all keys except metadata fields)
            categories = {k: v for k, v in result.items() if k not in metadata_keys}

            analysis_id = f"img_analysis_{uuid.uuid4().hex[:12]}"
            await self.db.ai_image_analysis.insert_one(
                {
                    "analysis_id": analysis_id,
                    "image_url": image_url,
                    "categories": categories,  # Store categorized concepts
                    "confidence_score": result.get("confidence_score", 0.0),
                    "visual_notes": result.get("visual_notes", ""),
                    "entity_type": entity_type,
                    "model": config["model"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return result
