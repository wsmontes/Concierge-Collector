/*
 * OfflineCaptureProcessor
 *
 * Durable raw-media -> textual-source materializer. Numeric Dexie ids locate
 * local blobs; stable sourceId values identify provenance. Processing does not
 * depend on the editor DOM and is safe to resume after crash/reconnect.
 */
(function exposeOfflineCaptureProcessor(global) {
    'use strict';

    class OfflineCaptureProcessor {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineCaptureProcessor') || console;
            this._inFlight = null;
            this._runtimeInstalled = false;
            this._recordingCaptureInstalled = false;
            this._saveMaterializationInstalled = false;
            this._timer = null;
        }

        start() {
            if (this._runtimeInstalled) return this;
            this._runtimeInstalled = true;
            this.runtime.addEventListener?.('online', () => this.processPending().catch((error) => {
                this.log.warn('Reconnect capture processing failed:', error);
            }));
            this._pollForRuntime();
            return this;
        }

        _pollForRuntime(attempt = 0) {
            this.installRecordingTranscriptCapture();
            this.installSaveSourceMaterialization();
            if (this.dependenciesReady() && this._recordingCaptureInstalled && this._saveMaterializationInstalled) {
                if (this.runtime.navigator?.onLine !== false) setTimeout(() => this.processPending().catch(() => {}), 0);
                return;
            }
            if (attempt >= 300) return;
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollForRuntime(attempt + 1), 100);
        }

        dependenciesReady() {
            return Boolean(
                this.runtime.DataStore?.db?.pendingAudio &&
                this.runtime.PendingAudioManager?.getAudios &&
                this.runtime.ApiService?.transcribeAudio
            );
        }

        extractTranscript(result) {
            if (!result) return '';
            if (typeof result === 'string') return result.trim();
            if (typeof result.text === 'string') return result.text.trim();
            if (typeof result.transcription?.text === 'string') return result.transcription.text.trim();
            if (typeof result.results?.transcription?.text === 'string') return result.results.transcription.text.trim();
            return '';
        }

        extractConcepts(result) {
            const candidates = result?.concepts?.concepts || result?.results?.concepts?.concepts || [];
            return Array.isArray(candidates) ? candidates : [];
        }

        extractTranscriptionMetadata(result, audio = {}) {
            const transcription = result?.results?.transcription || result?.transcription || {};
            return {
                language: transcription?.language || result?.language || audio.language || null,
                durationSeconds:
                    transcription?.duration_seconds ??
                    transcription?.duration ??
                    result?.duration_seconds ??
                    result?.duration ??
                    audio.durationSeconds ??
                    null,
                transcriptionModel:
                    transcription?.transcription_model ||
                    transcription?.model ||
                    result?.transcription_model ||
                    result?.model ||
                    audio.transcriptionModel ||
                    audio.model ||
                    null
            };
        }

        _toIso(value) {
            const fallback = new Date().toISOString();
            if (!value) return fallback;
            try {
                const date = value instanceof Date ? value : new Date(value);
                return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
            } catch (_) {
                return fallback;
            }
        }

        /**
         * `sources.audio[]` remains the compatibility bucket name, but each
         * entry is durable voice-originated TEXTUAL evidence. It intentionally
         * contains no raw-audio locator/url/storage reference.
         */
        sourceEntry(audio, transcript) {
            const text = String(transcript || '').trim();
            const capturedAt = this._toIso(audio.capturedAt || audio.timestamp);
            const model = audio.transcriptionModel || audio.model || null;
            return {
                source_id: audio.sourceId,
                type: 'voice_transcript',
                capture_type: 'voice',
                text,
                transcript: text,
                curator_id: audio.curatorId || null,
                captured_at: capturedAt,
                created_at: capturedAt,
                language: audio.language || null,
                duration_seconds: audio.durationSeconds ?? null,
                transcription_model: model,
                model
            };
        }

        appendAggregate(existing, text) {
            const current = String(existing || '').trim();
            const next = String(text || '').trim();
            if (!next) return current || null;
            if (!current) return next;
            return `${current}\n\n${next}`;
        }

        mergeConceptCategories(categories = {}, concepts = []) {
            const result = { ...(categories || {}) };
            for (const concept of concepts || []) {
                const rawCategory = concept?.category || concept?.concept_name || 'general';
                const value = concept?.value || concept?.name || concept?.item;
                if (!value) continue;
                const key = String(rawCategory).toLowerCase().replace(/\s+/g, '_');
                const values = Array.isArray(result[key]) ? [...result[key]] : [];
                if (!values.includes(value)) values.push(value);
                result[key] = values;
            }
            return result;
        }

        async findCuration(curationId) {
            if (!curationId) return null;
            const table = this.runtime.DataStore?.db?.curations;
            if (!table) return null;
            if (table.where) {
                try {
                    const row = await table.where('curation_id').equals(curationId).first();
                    if (row) return row;
                } catch (_) {}
            }
            if (table.get) {
                try { return await table.get(curationId); } catch (_) {}
            }
            return null;
        }

        async materializeIntoCuration(audio, transcript, result = null) {
            const table = this.runtime.DataStore?.db?.curations;
            const curation = await this.findCuration(audio.curationId);
            if (!table || !curation) return false;

            const sources = { ...(curation.sources || {}) };
            const audioSources = Array.isArray(sources.audio) ? [...sources.audio] : [];
            const sourceId = String(audio.sourceId || '');
            const existingIndex = audioSources.findIndex((source) => String(source?.source_id || '') === sourceId);
            const isNewSource = existingIndex < 0;
            const source = this.sourceEntry(audio, transcript);
            if (isNewSource) audioSources.push(source);
            else audioSources[existingIndex] = { ...audioSources[existingIndex], ...source };
            sources.audio = audioSources;

            await table.put({
                ...curation,
                transcript: isNewSource ? this.appendAggregate(curation.transcript, transcript) : curation.transcript,
                sources,
                categories: this.mergeConceptCategories(curation.categories || {}, this.extractConcepts(result)),
                updated_at: new Date().toISOString(),
                updatedAt: new Date(),
                sync: { ...(curation.sync || {}), status: 'pending', lastModified: new Date().toISOString() }
            });
            return true;
        }

        async materializeIntoDraft(audio, transcript, result = null) {
            const table = this.runtime.DataStore?.db?.draftRestaurants;
            if (!table || !audio.draftId) return false;
            const draft = await table.get(audio.draftId);
            if (!draft) return false;

            let metadata = {};
            try { metadata = draft.metadata ? JSON.parse(draft.metadata) : {}; } catch (_) {}
            const voiceSources = Array.isArray(metadata.voiceSources) ? [...metadata.voiceSources] : [];
            const sourceId = String(audio.sourceId || '');
            const existingIndex = voiceSources.findIndex((source) => String(source?.source_id || '') === sourceId);
            const isNewSource = existingIndex < 0;
            const source = this.sourceEntry(audio, transcript);
            if (isNewSource) voiceSources.push(source);
            else voiceSources[existingIndex] = { ...voiceSources[existingIndex], ...source };
            metadata.voiceSources = voiceSources;

            const concepts = this.extractConcepts(result);
            if (concepts.length) {
                const categoryObject = this.mergeConceptCategories({}, concepts);
                const additions = Object.entries(categoryObject)
                    .flatMap(([category, values]) => values.map((value) => ({ category, value })));
                const existingConcepts = Array.isArray(metadata.concepts) ? metadata.concepts : [];
                const seen = new Set(existingConcepts.map((item) => `${item.category}\u0000${item.value}`));
                metadata.concepts = [...existingConcepts];
                for (const item of additions) {
                    const key = `${item.category}\u0000${item.value}`;
                    if (!seen.has(key)) {
                        metadata.concepts.push(item);
                        seen.add(key);
                    }
                }
            }

            await table.update(audio.draftId, {
                transcription: isNewSource ? this.appendAggregate(draft.transcription, transcript) : draft.transcription,
                hasAudio: true,
                metadata: JSON.stringify(metadata),
                lastModified: new Date()
            });
            return true;
        }

        async processAudio(audio) {
            const manager = this.runtime.PendingAudioManager;
            const claimed = await manager.claimForProcessing(audio.id ?? audio.sourceId);
            if (!claimed) return { status: 'skipped' };
            try {
                let transcript = String(claimed.transcriptText || '').trim();
                let result = null;
                let metadata = this.extractTranscriptionMetadata(null, claimed);
                if (!transcript) {
                    // Never force English on reconnect. A known capture language
                    // is reused; otherwise undefined lets ApiService apply its
                    // configured/default transcription language.
                    result = await this.runtime.ApiService.transcribeAudio(
                        claimed.audioBlob,
                        claimed.language || undefined
                    );
                    transcript = this.extractTranscript(result);
                    if (!transcript) throw new Error('Transcription returned no text');
                    metadata = this.extractTranscriptionMetadata(result, claimed);
                    await manager.storeTranscript?.(
                        claimed.id ?? claimed.sourceId,
                        transcript,
                        metadata
                    );
                }

                const materializedAudio = {
                    ...claimed,
                    ...metadata,
                    transcriptText: transcript
                };

                let persisted = false;
                if (claimed.curationId) persisted = await this.materializeIntoCuration(materializedAudio, transcript, result);
                if (!persisted && claimed.draftId) persisted = await this.materializeIntoDraft(materializedAudio, transcript, result);
                if (!persisted) throw new Error('Capture has no durable Curation or draft target');

                await manager.markTranscriptPersisted(claimed.sourceId || claimed.id, {
                    curationId: claimed.curationId || null,
                    draftId: claimed.draftId || null
                });
                return { status: 'processed', sourceId: claimed.sourceId };
            } catch (error) {
                await manager.markProcessingFailed?.(claimed.id ?? claimed.sourceId, error);
                return { status: 'failed', error, sourceId: claimed.sourceId };
            }
        }

        async _runPending() {
            if (this.runtime.navigator?.onLine === false || !this.dependenciesReady()) return { processed: 0, failed: 0, skipped: 0 };
            const rows = await this.runtime.PendingAudioManager.getAudios();
            const eligible = rows
                .filter((audio) => audio?.audioBlob && audio.disposable !== true)
                .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
            const summary = { processed: 0, failed: 0, skipped: 0 };
            for (const audio of eligible) {
                const result = await this.processAudio(audio);
                if (result.status === 'processed') summary.processed++;
                else if (result.status === 'failed') summary.failed++;
                else summary.skipped++;
            }
            await this.runtime.PendingAudioManager.prune?.();
            return summary;
        }

        processPending() {
            if (this._inFlight) return this._inFlight;
            this._inFlight = this._runPending().finally(() => { this._inFlight = null; });
            return this._inFlight;
        }

        installRecordingTranscriptCapture() {
            const recording = this.runtime.uiManager?.recordingModule;
            const manager = this.runtime.PendingAudioManager;
            if (!recording?.processTranscription || !manager?.getAudio || this._recordingCaptureInstalled) return false;

            const originalProcessTranscription = recording.processTranscription.bind(recording);
            recording.processTranscription = async (result, ...args) => {
                const text = this.extractTranscript(result);
                const localId = recording.currentAudioId;
                if (localId && text) {
                    const audio = await manager.getAudio(localId).catch(() => null);
                    if (audio) {
                        recording.currentAudioSourceId = audio.sourceId || null;
                        const metadata = this.extractTranscriptionMetadata(result, audio);
                        await manager.storeTranscript?.(localId, text, metadata).catch((error) => {
                            this.log.warn('Could not persist source-local transcript before UI apply:', error);
                        });
                    }
                }
                return originalProcessTranscription(result, ...args);
            };

            // Clear stale source identity at the beginning of a fresh capture.
            if (recording.processRecording && !recording.__offlineCaptureProcessRecordingInstalled) {
                const originalProcessRecording = recording.processRecording.bind(recording);
                recording.processRecording = async (audioBlob, pendingAudioId = null, ...args) => {
                    recording.currentAudioSourceId = null;
                    if (pendingAudioId) {
                        const row = await manager.getAudio(pendingAudioId).catch(() => null);
                        if (row?.sourceId) recording.currentAudioSourceId = row.sourceId;
                    }
                    return originalProcessRecording(audioBlob, pendingAudioId, ...args);
                };
                recording.__offlineCaptureProcessRecordingInstalled = true;
            }

            if (recording.discardCurrentRecording && !recording.__offlineCaptureDiscardInstalled) {
                const originalDiscard = recording.discardCurrentRecording.bind(recording);
                recording.discardCurrentRecording = async (...args) => {
                    const result = await originalDiscard(...args);
                    recording.currentAudioSourceId = null;
                    return result;
                };
                recording.__offlineCaptureDiscardInstalled = true;
            }

            recording.__offlineCaptureTranscriptInstalled = true;
            this._recordingCaptureInstalled = true;
            return true;
        }

        async _pendingRowsForSave(uiManager) {
            const manager = this.runtime.PendingAudioManager;
            const draftId = this.runtime.DraftRestaurantManager?.currentDraftId || null;
            const curationId = uiManager?.restaurantModule?.currentCuration?.curation_id || null;
            const rows = [];
            if (draftId) rows.push(...await manager.getAudios({ draftId }));
            if (curationId) rows.push(...await manager.getAudios({ curationId }));
            const unique = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
            return [...unique.values()];
        }

        normalizeVoiceSources(curation, pendingRows, draftSnapshot = null) {
            const sources = { ...(curation.sources || {}) };
            let audio = Array.isArray(sources.audio) ? [...sources.audio] : [];
            const localIds = new Set(pendingRows.map((row) => String(row.id)));
            // Transitional entries using numeric blob ids are not durable provenance.
            audio = audio.filter((source) => !localIds.has(String(source?.source_id ?? '')));

            const candidates = [
                ...(Array.isArray(draftSnapshot?.voiceSources) ? draftSnapshot.voiceSources : []),
                ...pendingRows
                    .filter((row) => row?.sourceId && String(row.transcriptText || '').trim())
                    .map((row) => this.sourceEntry(row, String(row.transcriptText).trim()))
            ];
            for (const candidate of candidates) {
                if (!candidate?.source_id || !String(candidate.transcript || candidate.text || '').trim()) continue;
                const index = audio.findIndex((source) => String(source?.source_id || '') === String(candidate.source_id));
                if (index >= 0) audio[index] = { ...audio[index], ...candidate };
                else audio.push(candidate);
            }
            if (audio.length) sources.audio = audio;
            else delete sources.audio;
            return sources;
        }

        installSaveSourceMaterialization() {
            const uiManager = this.runtime.uiManager;
            const conceptModule = uiManager?.conceptModule;
            // Part 1 must be inside this wrapper so its cleanup/check sees the
            // final normalized Curation after our put interceptor returns.
            if (!conceptModule?.__offlineDurabilitySaveInstalled || this._saveMaterializationInstalled || conceptModule.__offlineCaptureSaveInstalled) {
                return false;
            }

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            conceptModule.__offlineCaptureSaveInstalled = true;
            conceptModule.__offlineCaptureOriginalSaveRestaurant = originalSave;

            conceptModule.saveRestaurant = async (...args) => {
                const pendingRows = await this._pendingRowsForSave(uiManager);
                const draftId = this.runtime.DraftRestaurantManager?.currentDraftId || null;
                const draftSnapshot = draftId ? await this.runtime.DraftRestaurantManager?.getDraft?.(draftId).catch(() => null) : null;
                const table = this.runtime.DataStore?.db?.curations;
                const originalPut = table?.put;
                let captured = null;

                if (table && typeof originalPut === 'function') {
                    table.put = async (curation, ...putArgs) => {
                        curation.sources = this.normalizeVoiceSources(curation, pendingRows, draftSnapshot);
                        captured = curation;
                        return originalPut.call(table, curation, ...putArgs);
                    };
                }

                try {
                    const saved = await originalSave(...args);
                    if (saved !== true || !captured?.curation_id) return saved;
                    const stableIds = new Set((captured.sources?.audio || []).map((source) => String(source?.source_id || '')));
                    for (const row of pendingRows) {
                        if (row?.sourceId && row.transcriptText && stableIds.has(String(row.sourceId))) {
                            await this.runtime.PendingAudioManager.markTranscriptPersisted(row.sourceId, { curationId: captured.curation_id });
                        }
                    }
                    return saved;
                } finally {
                    if (table && typeof originalPut === 'function') table.put = originalPut;
                }
            };

            this._saveMaterializationInstalled = true;
            return true;
        }
    }

    global.OfflineCaptureProcessor = OfflineCaptureProcessor;
    if (global.document && !global.offlineCaptureProcessor) {
        global.offlineCaptureProcessor = new OfflineCaptureProcessor(global).start();
    }
})(window);