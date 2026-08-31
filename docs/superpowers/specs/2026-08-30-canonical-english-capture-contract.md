# Collector Canonical-English Capture Contract

**Status:** Product invariant approved during offline-first implementation, 2026-08-30.

## Rule

The Concierge database stores editorial text in English. A curator may speak any language while capturing a voice review, but every durable textual representation produced from that audio MUST be English before it becomes Curation/source truth.

```text
spoken audio: any language
        ↓
raw audio: local + authoritative while no durable text exists
        ↓
English translation/transcription
        ↓
durable textual source (`language = en`)
        ↓
aggregate Curation transcript / concept extraction / sync
```

## Source semantics

A durable voice source uses the compatibility bucket `sources.audio[]`, but it represents **voice-originated textual evidence**, not a durable audio asset.

```json
{
  "source_id": "src_...",
  "type": "voice_transcript",
  "capture_type": "voice",
  "text": "I loved the risotto and the room was very calm.",
  "transcript": "I loved the risotto and the room was very calm.",
  "language": "en",
  "source_language": "pt-BR",
  "curator_id": "curator@example.com",
  "captured_at": "2026-08-30T18:31:02Z",
  "duration_seconds": 64.2,
  "transcription_model": "whisper-1"
}
```

`source_language` is optional provenance metadata and MUST NOT change the canonical text language. If the original spoken language is unknown, omit/null `source_language`; never infer it from the English output.

## OpenAI/API implication

The OpenAI audio **transcriptions** `language` parameter describes the input language. Passing `language=en` for Portuguese speech is therefore not a translation contract.

Collector canonical ingestion must use an English-output translation path. The backend enforces this centrally with `CanonicalEnglishOpenAIService`, which uses the audio translations operation and returns `language: "en"` regardless of the legacy caller language hint.

This rule lives at the backend service boundary so an old browser, reconnect processor, capture client, or future caller cannot accidentally persist non-English canonical text.

## Offline implication

While offline there is no canonical transcript yet, so raw audio remains authoritative and must not be deleted. On reconnect:

1. Translate the raw capture to English.
2. Persist the English source locally under its stable `source_id`.
3. Update the aggregate Curation transcript/concepts from that English text.
4. Only after durable local materialization may the raw audio be released.

A translation/API failure leaves the raw recording intact for retry.

## Non-negotiable tests

- Portuguese-origin audio produces English persisted source text.
- Unknown source-language audio still produces English persisted source text.
- Reconnect and editor-open paths use the same English contract.
- `language` on durable voice sources is `en`.
- Raw audio is retained until that English textual source is durably persisted.
