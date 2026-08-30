/*
 * OfflinePhotoProcessor
 *
 * Makes photo capture truly offline-first without introducing permanent media
 * storage. Accepted photos remain in the durable draft. Only photos whose
 * curator explicitly selected AI analysis are registered in `photoProcessing`.
 * Reconnect resumes those analyses idempotently and materializes concepts plus
 * stable photo provenance into the saved Curation. Successful analysis does
 * NOT delete the raw photo; retention is a separate product policy.
 */
(function exposeOfflinePhotoProcessor(global) {
    'use strict';

    class OfflinePhotoProcessor {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflinePhotoProcessor') || console;
            this._started = false;
            this._queueCaptureInstalled = false;
            this._photoAutosaveInstalled = false;
            this._inFlight = null;
            this._timer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this.runtime.addEventListener?.('online', () => {
                this.processPending().catch((error) => this.log.warn('Photo reconnect processing failed:', error));
            });
            this._pollRuntime();
            return this;
        }

        _pollRuntime(attempt = 0) {
            this.installPhotoAutosave();
            this.installQueueCapture();
            if (this.dependenciesReady() && this._queueCaptureInstalled && this._photoAutosaveInstalled) {
                if (this.runtime.navigator?.onLine !== false) {
                    this.runtime.setTimeout?.(() => this.processPending().catch(() => {}), 0);
                }
                return;
            }
            if (attempt >= 300) {
                this.log.warn('Photo offline processor could not attach to authoring runtime');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollRuntime(attempt + 1), 100);
        }

        dependenciesReady() {
            return Boolean(
                this.runtime.DataStore?.db?.draftRestaurants &&
                this.runtime.DataStore?.db?.curations &&
                this.runtime.DraftRestaurantManager?.getDrafts &&
                this.runtime.ApiService?.analyzeImage
            );
        }

        photoData(photo) {
            if (typeof photo === 'string') return photo;
            return photo?.photoData || photo?.data || null;
        }

        _toIso(value, fallback = new Date().toISOString()) {
            if (!value) return fallback;
            try {
                const date = value instanceof Date ? value : new Date(value);
                return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
            } catch (_) {
                return fallback;
            }
        }

        async sourceIdForPhoto(photo) {
            const data = String(this.photoData(photo) || '');
            if (!data) throw new Error('Photo data is empty');

            const crypto = this.runtime.crypto;
            const Encoder = this.runtime.TextEncoder || global.TextEncoder;
            if (crypto?.subtle?.digest && Encoder) {
                const bytes = new Encoder().encode(data);
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                const hex = [...new Uint8Array(digest)]
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('');
                return `src_photo_${hex}`;
            }

            // Deterministic fallback for old browsers. Modern target browsers
            // use SHA-256 above; this is identity continuity, not security.
            let a = 2166136261;
            let b = 2246822519;
            for (let i = 0; i < data.length; i += 1) {
                const code = data.charCodeAt(i);
                a ^= code;
                a = Math.imul(a, 16777619) >>> 0;
                b ^= code + i;
                b = Math.imul(b, 3266489917) >>> 0;
            }
            return `src_photo_${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}_${data.length}`;
        }

        async _getRawDraft(draftId) {
            return await this.runtime.DataStore?.db?.draftRestaurants?.get?.(draftId) || null;
        }

        async _updatePhotoProcessing(draftId, updater) {
            const table = this.runtime.DataStore?.db?.draftRestaurants;
            const raw = await this._getRawDraft(draftId);
            if (!table?.update || !raw) return null;
            const current = raw.photoProcessing && typeof raw.photoProcessing === 'object'
                ? { ...raw.photoProcessing }
                : {};
            const next = await updater(current, raw);
            await table.update(draftId, {
                photoProcessing: next || current,
                lastModified: new Date()
            });
            return next || current;
        }

        installPhotoAutosave() {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (!conceptModule?.addPhotoToCollection) return false;
            if (this._photoAutosaveInstalled || conceptModule.__offlinePhotoAutosaveInstalled) {
                this._photoAutosaveInstalled = true;
                return true;
            }

            const original = conceptModule.addPhotoToCollection.bind(conceptModule);
            conceptModule.__offlinePhotoAutosaveInstalled = true;
            conceptModule.__offlinePhotoAutosaveOriginal = original;
            conceptModule.addPhotoToCollection = (...args) => {
                const result = original(...args);
                Promise.resolve(conceptModule.autoSaveDraft?.()).catch((error) => {
                    this.log.warn('Could not autosave accepted photo:', error);
                });
                return result;
            };
            this._photoAutosaveInstalled = true;
            return true;
        }

        installQueueCapture() {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (!conceptModule?.processImageQueue) return false;
            if (this._queueCaptureInstalled || conceptModule.__offlinePhotoQueueCaptureInstalled) {
                this._queueCaptureInstalled = true;
                return true;
            }

            const original = conceptModule.processImageQueue.bind(conceptModule);
            conceptModule.__offlinePhotoQueueCaptureInstalled = true;
            conceptModule.__offlinePhotoQueueCaptureOriginal = original;
            conceptModule.processImageQueue = async (...args) => {
                if (this.runtime.navigator?.onLine !== false) {
                    return original(...args);
                }

                const queued = Array.isArray(conceptModule.imageProcessingQueue)
                    ? [...conceptModule.imageProcessingQueue].filter((photo) => this.photoData(photo))
                    : [];
                if (!queued.length) {
                    conceptModule.isProcessingQueue = false;
                    return { queued: 0, offline: true };
                }

                // Force the accepted raw photos into the durable draft before
                // converting the in-memory AI queue into durable intent.
                await conceptModule.autoSaveDraft?.();
                await this.runtime.DraftRestaurantManager?.flushPendingSave?.();
                const draftId = this.runtime.DraftRestaurantManager?.currentDraftId || null;
                if (!draftId) {
                    this.log.warn('No durable draft available; retaining photo AI queue in memory');
                    return { queued: 0, offline: true, preserved: false };
                }

                const capturedAt = new Date().toISOString();
                await this._updatePhotoProcessing(draftId, async (states) => {
                    for (const photo of queued) {
                        const sourceId = await this.sourceIdForPhoto(photo);
                        const previous = states[sourceId] || {};
                        states[sourceId] = {
                            ...previous,
                            sourceId,
                            status: previous.status === 'processed' ? 'processed' : 'pending',
                            capturedAt: previous.capturedAt || capturedAt,
                            retryCount: previous.retryCount || 0,
                            lastError: null
                        };
                    }
                    return states;
                });

                conceptModule.imageProcessingQueue.length = 0;
                conceptModule.isProcessingQueue = false;
                this.runtime.uiUtils?.showNotification?.(
                    `${queued.length} photo${queued.length === 1 ? '' : 's'} saved for AI analysis when online`,
                    'info'
                );
                return { queued: queued.length, offline: true, preserved: true };
            };

            this._queueCaptureInstalled = true;
            return true;
        }

        dataUrlToBlob(photo) {
            const value = String(this.photoData(photo) || '');
            if (!value) throw new Error('Photo data is empty');
            const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
            if (!match) return new this.runtime.Blob([value], { type: 'application/octet-stream' });

            const mime = match[1] || 'application/octet-stream';
            const encoded = match[3] || '';
            if (match[2]) {
                const decode = this.runtime.atob || global.atob;
                const binary = decode(encoded);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                return new this.runtime.Blob([bytes], { type: mime });
            }
            return new this.runtime.Blob([decodeURIComponent(encoded)], { type: mime });
        }

        analysisPayload(result) {
            return result?.results?.image_analysis ||
                result?.image_analysis ||
                result?.results?.analysis ||
                result?.analysis ||
                result || {};
        }

        extractCategories(result) {
            const analysis = this.analysisPayload(result);
            if (analysis?.categories && typeof analysis.categories === 'object' && !Array.isArray(analysis.categories)) {
                return analysis.categories;
            }
            const metadata = new Set([
                'confidence_score', 'entity_type', 'model', 'visual_notes',
                'restaurant_name', 'name', 'analysis_id', 'source', 'language'
            ]);
            const categories = {};
            for (const [key, value] of Object.entries(analysis || {})) {
                if (metadata.has(key) || !Array.isArray(value)) continue;
                const values = value.map((item) => String(item).trim()).filter(Boolean);
                if (values.length) categories[key] = values;
            }
            return categories;
        }

        extractModel(result) {
            const analysis = this.analysisPayload(result);
            return analysis?.model || result?.model || null;
        }

        extractRestaurantName(result) {
            const analysis = this.analysisPayload(result);
            const value = analysis?.restaurant_name || analysis?.name || null;
            return value && String(value).trim() ? String(value).trim() : null;
        }

        mergeCategories(existing = {}, additions = {}) {
            const merged = { ...(existing || {}) };
            for (const [key, values] of Object.entries(additions || {})) {
                const list = Array.isArray(merged[key]) ? [...merged[key]] : [];
                for (const value of Array.isArray(values) ? values : []) {
                    if (!list.includes(value)) list.push(value);
                }
                if (list.length) merged[key] = list;
            }
            return merged;
        }

        categoriesToConcepts(existing = [], categories = {}) {
            const result = Array.isArray(existing) ? [...existing] : [];
            const seen = new Set(result.map((item) => `${item?.category}\u0000${item?.value}`));
            for (const [category, values] of Object.entries(categories || {})) {
                for (const value of Array.isArray(values) ? values : []) {
                    const key = `${category}\u0000${value}`;
                    if (!seen.has(key)) {
                        result.push({ category, value });
                        seen.add(key);
                    }
                }
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
            return table.get ? await table.get(curationId) : null;
        }

        photoSourceEntry(sourceId, state, result) {
            const capturedAt = this._toIso(state?.capturedAt);
            return {
                source_id: sourceId,
                type: 'photo_capture',
                capture_type: 'photo',
                captured_at: capturedAt,
                created_at: capturedAt,
                analyzed_at: new Date().toISOString(),
                analysis_model: this.extractModel(result)
            };
        }

        async materialize(draft, sourceId, state, result) {
            const categories = this.extractCategories(result);
            const proposedName = this.extractRestaurantName(result);
            const manager = this.runtime.DraftRestaurantManager;
            const curationId = draft.savedCurationId || draft.targetCurationId || null;
            const curation = curationId ? await this.findCuration(curationId) : null;

            if (draft.savedCurationId && !curation) {
                throw new Error(`Saved Curation ${draft.savedCurationId} not found locally`);
            }

            const draftConcepts = this.categoriesToConcepts(draft.concepts || [], categories);
            const draftUpdates = { concepts: draftConcepts };
            if (!String(draft.name || '').trim() && proposedName) draftUpdates.name = proposedName;
            await manager.updateDraft?.(draft.id, draftUpdates);

            if (!curation) return true;

            const sources = { ...(curation.sources || {}) };
            let images = Array.isArray(sources.image) ? [...sources.image] : [];
            // Replace only the anonymous marker generated by the same legacy
            // Save path; preserve any richer historical image provenance.
            images = images.filter((entry) => {
                if (entry?.source_id) return true;
                const keys = Object.keys(entry || {});
                return keys.some((key) => key !== 'created_at');
            });
            const entry = this.photoSourceEntry(sourceId, state, result);
            const existingIndex = images.findIndex((item) => String(item?.source_id || '') === String(sourceId));
            if (existingIndex >= 0) images[existingIndex] = { ...images[existingIndex], ...entry };
            else images.push(entry);
            sources.image = images;

            await this.runtime.DataStore.db.curations.put({
                ...curation,
                categories: this.mergeCategories(curation.categories || {}, categories),
                sources,
                updated_at: new Date().toISOString(),
                updatedAt: new Date(),
                sync: {
                    ...(curation.sync || {}),
                    status: 'pending',
                    lastModified: new Date().toISOString()
                }
            });
            return true;
        }

        async processPhoto(draft, photo, sourceId, state) {
            await this._updatePhotoProcessing(draft.id, (states) => {
                states[sourceId] = {
                    ...(states[sourceId] || state || {}),
                    sourceId,
                    status: 'processing',
                    processingStartedAt: new Date().toISOString(),
                    lastError: null
                };
                return states;
            });

            try {
                const blob = this.dataUrlToBlob(photo);
                const result = await this.runtime.ApiService.analyzeImage(
                    blob,
                    'Extract canonical restaurant concepts and identifying information from this image.'
                );
                await this.materialize(draft, sourceId, state, result);
                await this._updatePhotoProcessing(draft.id, (states) => {
                    states[sourceId] = {
                        ...(states[sourceId] || state || {}),
                        sourceId,
                        status: 'processed',
                        processedAt: new Date().toISOString(),
                        processingStartedAt: null,
                        lastError: null
                    };
                    return states;
                });
                return { status: 'processed', sourceId };
            } catch (error) {
                await this._updatePhotoProcessing(draft.id, (states) => {
                    const previous = states[sourceId] || state || {};
                    states[sourceId] = {
                        ...previous,
                        sourceId,
                        status: 'failed',
                        retryCount: (previous.retryCount || 0) + 1,
                        processingStartedAt: null,
                        lastError: String(error?.message || error || 'Photo analysis failed')
                    };
                    return states;
                });
                return { status: 'failed', sourceId, error };
            }
        }

        async _runPending() {
            if (this.runtime.navigator?.onLine === false || !this.dependenciesReady()) {
                return { processed: 0, failed: 0, skipped: 0 };
            }

            const drafts = await this.runtime.DraftRestaurantManager.getDrafts();
            const summary = { processed: 0, failed: 0, skipped: 0 };
            for (const draft of drafts) {
                const states = draft?.photoProcessing && typeof draft.photoProcessing === 'object'
                    ? draft.photoProcessing
                    : {};
                const registered = Object.values(states).filter((state) =>
                    state?.sourceId && state.status !== 'processed'
                );
                if (!registered.length) continue;

                const photos = Array.isArray(draft.photos) ? draft.photos : [];
                const bySourceId = new Map();
                for (const photo of photos) {
                    const data = this.photoData(photo);
                    if (!data) continue;
                    bySourceId.set(await this.sourceIdForPhoto(data), photo);
                }

                for (const state of registered) {
                    const photo = bySourceId.get(state.sourceId);
                    if (!photo) {
                        summary.skipped += 1;
                        continue;
                    }
                    const result = await this.processPhoto(draft, photo, state.sourceId, state);
                    if (result.status === 'processed') summary.processed += 1;
                    else summary.failed += 1;
                }
            }
            return summary;
        }

        processPending() {
            if (this._inFlight) return this._inFlight;
            this._inFlight = this._runPending().finally(() => { this._inFlight = null; });
            return this._inFlight;
        }
    }

    global.OfflinePhotoProcessor = OfflinePhotoProcessor;
    if (global.document && !global.offlinePhotoProcessor) {
        global.offlinePhotoProcessor = new OfflinePhotoProcessor(global).start();
    }
})(window);
