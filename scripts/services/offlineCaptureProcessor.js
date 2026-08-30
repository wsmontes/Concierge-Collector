/*
 * OfflineCaptureProcessor
 *
 * Durable raw-media -> textual-source materializer. It does not depend on the
 * editor DOM, so saved Curations captured offline can be processed after a
 * reload/reconnect. Raw audio is released only after the transcript source is
 * durably persisted in IndexedDB.
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
            if (this.dependenciesReady()) {
                if (this.runtime.navigator?.onLine !== false) {
                    setTimeout(() => this.processPending().catch(() => {}), 0);
                }
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

        sourceEntry(audio, transcript) {
            return {
                source_id: audio.sourceId,
                capture_type: 'voice',
                transcript,
                created_at: audio.timestamp ? new Date(audio.timestamp).toISOString() : new Date().toISOString()
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

            const updated = {
                ...curation,
                transcript: isNewSource ? this.appendAggregate(curation.transcript, transcript) : curation.transcript,
                sources,
                categories: this.mergeConceptCategories(curation.categories || {}, this.extractConcepts(result)),
                updated_at: new Date().toISOString(),
                updatedAt: new Date(),
                sync: {
                    ...(curation.sync || {}),
                    status: 'pending',
                    lastModified: new Date().toISOString()
                }
            };
            await table.put(updated);
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
                metadata.concepts = [
                    ...(Array.isArray(metadata.concepts) ? metadata.concepts : []),
                    ...Object.entries(categoryObject).flatMap(([category, values]) => values.map((value) => ({ category, value })))
                ];
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
                if (!transcript) {
                    result = await this.runtime.ApiService.transcribeAudio(claimed.audioBlob, 'en');
                    transcript = this.extractTranscript(result);
                    if (!transcript) throw new Error('Transcription returned no text');
                    await manager.storeTranscript?.(claimed.id ?? claimed.sourceId, transcript);
                }

                let persisted = false;
                if (claimed.curationId) persisted = await this.materializeIntoCuration(claimed, transcript, result);
                if (!persisted && claimed.draftId) persisted = await this.materializeIntoDraft(claimed, transcript, result);
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
            if (this.runtime.navigator?.onLine === false || !this.dependenciesReady()) {
                return { processed: 0, failed: 0, skipped: 0 };
            }
            const rows = await this.runtime.PendingAudioManager.getAudios();
            // Status is advisory. A stale `processing` row after a crash must
            // be reclaimed; the only terminal truth is `disposable === true`.
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

        /**
         * Capture the transcript for the exact raw row while the live editor
         * is open. This makes the subsequent Save use the stable sourceId and
         * source-local text instead of the aggregate textarea.
         */
        installRecordingTranscriptCapture() {
            const recording = this.runtime.uiManager?.recordingModule;
            const manager = this.runtime.PendingAudioManager;
            if (!recording?.processTranscription || !manager?.getAudio || this._recordingCaptureInstalled) return false;

            const original = recording.processTranscription.bind(recording);
            const processor = this;
            recording.processTranscription = async (result, ...args) => {
                const text = processor.extractTranscript(result);
                const localId = recording.currentAudioId;
                if (localId && text) {
                    const audio = await manager.getAudio(localId).catch(() => null);
                    if (audio) {
                        recording.currentAudioSourceId = audio.sourceId || null;
                        await manager.storeTranscript?.(localId, text).catch((error) => {
                            processor.log.warn('Could not persist source-local transcript before UI apply:', error);
                        });
                    }
                }
                return original(result, ...args);
            };
            recording.__offlineCaptureTranscriptInstalled = true;
            this._recordingCaptureInstalled = true;
            return true;
        }
    }

    global.OfflineCaptureProcessor = OfflineCaptureProcessor;
    if (global.document && !global.offlineCaptureProcessor) {
        global.offlineCaptureProcessor = new OfflineCaptureProcessor(global).start();
    }
})(window);
