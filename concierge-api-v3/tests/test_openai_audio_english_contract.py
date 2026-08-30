"""Contract tests for canonical-English audio ingestion."""

import io
from types import SimpleNamespace

import pytest

from app.services.canonical_english_openai_service import CanonicalEnglishOpenAIService


class _FakeConfigService:
    def get_config(self, name):
        assert name == "transcription"
        return {
            "model": "whisper-1",
            "config": {
                "temperature": 0,
                "response_format": "verbose_json",
                # Legacy config/input-language hints must never leak into the
                # translation request that defines canonical DB text.
                "language": "pt",
            },
        }


class _Recorder:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def _service(translations, transcriptions):
    service = CanonicalEnglishOpenAIService.__new__(CanonicalEnglishOpenAIService)
    service.config_service = _FakeConfigService()
    service.client = SimpleNamespace(
        audio=SimpleNamespace(
            translations=translations,
            transcriptions=transcriptions,
        )
    )
    return service


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_language", ["en", "pt-BR", "fr", None])
async def test_every_audio_language_materializes_as_english_translation(legacy_language):
    translation_response = SimpleNamespace(
        text="I loved the risotto and the room was very calm.",
        duration=64.2,
        language="english",
    )
    translations = _Recorder(translation_response)
    transcriptions = _Recorder(SimpleNamespace(text="should not be used"))
    service = _service(translations, transcriptions)

    audio = io.BytesIO(b"fake-audio")
    audio.name = "review.webm"

    result = await service.transcribe_audio(
        audio,
        language=legacy_language,
        save_to_cache=False,
    )

    assert len(translations.calls) == 1
    assert transcriptions.calls == []
    assert translations.calls[0]["model"] == "whisper-1"
    assert "language" not in translations.calls[0]
    assert result["text"] == "I loved the risotto and the room was very calm."
    assert result["language"] == "en"
    assert result["translated_to_english"] is True
    assert result["model"] == "whisper-1"
    assert result["duration"] == 64.2


@pytest.mark.asyncio
async def test_translation_filters_transcription_only_config_parameters():
    translations = _Recorder(SimpleNamespace(text="English text", duration=None))
    transcriptions = _Recorder(SimpleNamespace(text="should not be used"))
    service = _service(translations, transcriptions)

    audio = io.BytesIO(b"fake-audio")
    audio.name = "review.webm"
    await service.transcribe_audio(audio, language="en", save_to_cache=False)

    call = translations.calls[0]
    assert call["temperature"] == 0
    assert call["response_format"] == "verbose_json"
    assert "language" not in call
