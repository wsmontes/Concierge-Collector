"""Contract tests for canonical-English audio ingestion."""

import io
from types import SimpleNamespace

import pytest

from app.services.openai_service import OpenAIService


class _FakeConfigService:
    def get_config(self, name):
        assert name == "transcription"
        return {
            "model": "whisper-1",
            "config": {
                "temperature": 0,
                "response_format": "verbose_json",
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


@pytest.mark.asyncio
async def test_english_contract_uses_audio_translation_not_fake_english_transcription():
    translation_response = SimpleNamespace(
        text="I loved the risotto and the room was very calm.",
        duration=64.2,
        language="english",
    )
    translations = _Recorder(translation_response)
    transcriptions = _Recorder(SimpleNamespace(text="should not be used"))

    service = OpenAIService.__new__(OpenAIService)
    service.config_service = _FakeConfigService()
    service.client = SimpleNamespace(
        audio=SimpleNamespace(
            translations=translations,
            transcriptions=transcriptions,
        )
    )

    audio = io.BytesIO(b"fake-audio")
    audio.name = "review.webm"

    result = await service.transcribe_audio(audio, language="en", save_to_cache=False)

    assert len(translations.calls) == 1
    assert transcriptions.calls == []
    assert translations.calls[0]["model"] == "whisper-1"
    assert "language" not in translations.calls[0]
    assert result["text"] == "I loved the risotto and the room was very calm."
    assert result["language"] == "en"
    assert result["model"] == "whisper-1"
    assert result["duration"] == 64.2


@pytest.mark.asyncio
async def test_non_english_transcription_mode_remains_available_for_noncanonical_callers():
    transcriptions = _Recorder(SimpleNamespace(text="Adorei o risoto.", duration=12.0))
    translations = _Recorder(SimpleNamespace(text="should not be used"))

    service = OpenAIService.__new__(OpenAIService)
    service.config_service = _FakeConfigService()
    service.client = SimpleNamespace(
        audio=SimpleNamespace(
            translations=translations,
            transcriptions=transcriptions,
        )
    )

    audio = io.BytesIO(b"fake-audio")
    audio.name = "review.webm"

    result = await service.transcribe_audio(audio, language="pt-BR", save_to_cache=False)

    assert translations.calls == []
    assert len(transcriptions.calls) == 1
    assert transcriptions.calls[0]["language"] == "pt"
    assert result["language"] == "pt"
