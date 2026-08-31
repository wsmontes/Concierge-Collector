"""Canonical-English OpenAI service policy for Collector ingestion.

The Concierge database stores editorial text in English. Voice capture may be
spoken in any language, but the durable transcript that feeds Curations and
concept extraction must therefore be English.

OpenAI's transcription ``language`` parameter describes the *input* language;
it does not request translation. This policy uses the dedicated audio
translation endpoint instead, whose output is English.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.services.openai_service import OpenAIService

logger = logging.getLogger(__name__)


class CanonicalEnglishOpenAIService(OpenAIService):
    """OpenAIService variant whose audio text output is always English."""

    TRANSLATION_MODEL = "whisper-1"
    _TRANSLATION_PARAM_KEYS = {"prompt", "response_format", "temperature"}

    async def transcribe_audio(
        self,
        audio_data: Any,
        language: Optional[str] = None,
        save_to_cache: bool = True,
    ) -> Dict[str, Any]:
        """Translate arbitrary spoken audio into canonical English text.

        ``language`` is accepted for API compatibility with the legacy caller,
        but it is intentionally NOT sent as the input-language hint. Existing
        Collector clients historically pass ``"en"`` to mean "store English";
        sending that to ``audio.transcriptions`` for Portuguese speech would
        mislabel the input instead of translating it.
        """
        config = self.config_service.get_config("transcription")
        configured_params = dict(config.get("config") or {})
        translation_params = {
            key: value
            for key, value in configured_params.items()
            if key in self._TRANSLATION_PARAM_KEYS and value is not None
        }

        if isinstance(audio_data, str):
            logger.debug("Received base64 audio for canonical-English translation")
            audio_bytes = base64.b64decode(audio_data)
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "audio.mp3"
        else:
            audio_file = audio_data

        try:
            response = await asyncio.to_thread(
                self.client.audio.translations.create,
                model=self.TRANSLATION_MODEL,
                file=audio_file,
                **translation_params,
            )
        except Exception as exc:
            logger.error(
                "Canonical-English audio translation failed: %s: %s",
                type(exc).__name__,
                exc,
                exc_info=True,
            )
            raise

        transcription_id = f"trans_{uuid.uuid4().hex[:12]}"
        duration = getattr(response, "duration", None)
        result = {
            "transcription_id": transcription_id,
            "text": response.text,
            "language": "en",
            "model": self.TRANSLATION_MODEL,
            "duration": duration,
            "translated_to_english": True,
        }

        if save_to_cache:
            await self.db.ai_transcriptions.insert_one(
                {
                    **result,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return result
