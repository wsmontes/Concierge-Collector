/**
 * Pending Audio Manager Module
 *
 * Raw audio is authoritative until a durable textual source exists. Numeric
 * Dexie `id` is only the local blob locator; stable `sourceId` is provenance.
 */
const PendingAudioManager = ModuleWrapper.defineClass('PendingAudioManager', class {
    constructor() {
        this.log = Logger.module('PendingAudioManager');
        this.dataStorage = null;
        this.maxAutoRetries = 2;
        this.retryDelays = [5000, 15000];
        this.processingLeaseMs = 5 * 60 * 1000;
        this.processingOwnerId = this._newLeaseOwnerId();
    }

    init(dataStorage) { this.dataStorage = dataStorage; this.prune().catch((error) => this.log.warn('prune no init falhou:', error)); }
    canDeleteAudio(audio) { return Boolean(audio && audio.disposable === true); }

    async prune({ maxCount = 30, maxAgeDays = 7 } = {}) {
        try {
            const audios = await this.getAudios(); const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
            const sorted = audios.filter((audio) => audio?.id != null).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            const toDelete = [];
            sorted.forEach((audio, index) => { if (this.canDeleteAudio(audio) && (new Date(audio.timestamp || 0).getTime() < cutoff || index >= maxCount)) toDelete.push(audio.id); });
            for (const id of toDelete) await this.deleteAudio(id).catch(() => {});
        } catch (error) { this.log.error('Prune de áudios pendentes falhou:', error); }
    }

    _newSourceId() {
        try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
        return `src_voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    _newLeaseOwnerId() {
        try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return `tab_${crypto.randomUUID()}`; } catch (_) {}
        return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    _newLeaseToken() {
        try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
        return `lease_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    _leaseExpiryMs(audio) {
        if (!audio?.processingLeaseExpiresAt) return 0;
        const value = new Date(audio.processingLeaseExpiresAt).getTime();
        return Number.isFinite(value) ? value : 0;
    }

    _leaseIsActive(audio, now = Date.now()) {
        return Boolean(audio?.processingLeaseToken && this._leaseExpiryMs(audio) > now);
    }

    _assertLease(audio, leaseToken) {
        // Legacy/manual callers that do not participate in the durable
        // processor contract remain compatible. Once a worker supplies a
        // token, however, only the current unexpired owner may mutate state.
        if (!leaseToken) return true;
        if (!audio?.processingLeaseToken || audio.processingLeaseToken !== leaseToken || !this._leaseIsActive(audio)) {
            const error = new Error('Pending audio processing lease was lost');
            error.name = 'ProcessingLeaseLostError';
            throw error;
        }
        return true;
    }

    async _withPendingAudioTransaction(task) {
        const db = this.dataStorage?.db;
        const table = db?.pendingAudio;
        if (!table) throw new Error('Pending audio storage is not initialized');
        if (typeof db.transaction === 'function') {
            return db.transaction('rw', table, task);
        }
        return task();
    }

    _currentCuratorId(options = {}) {
        const explicit = options.curatorId || options.curator_id;
        if (explicit) return String(explicit);
        try {
            const profile = typeof window !== 'undefined' ? window.CuratorProfile?.getCurrentCurator?.() : null;
            if (profile?.curator_id) return String(profile.curator_id);
        } catch (_) {}
        try {
            const resolved = typeof window !== 'undefined' ? window.uiManager?.conceptModule?.resolveCuratorId?.() : null;
            if (resolved) return String(resolved);
        } catch (_) {}
        const current = typeof window !== 'undefined' ? window.uiManager?.currentCurator : null;
        const legacy = current?.id || current?.curator_id || current?.email || null;
        return legacy ? String(legacy) : null;
    }

    async saveAudio(audioBlob, options = {}) {
        let blob = audioBlob; let opts = options;
        if (audioBlob && !(audioBlob instanceof Blob) && audioBlob.audioBlob) { blob = audioBlob.audioBlob; opts = audioBlob; }
        const capturedAt = opts.capturedAt instanceof Date
            ? opts.capturedAt
            : (opts.capturedAt ? new Date(opts.capturedAt) : new Date());
        const row = {
            sourceId: opts.sourceId || this._newSourceId(),
            audioBlob: blob,
            restaurantId: opts.restaurantId || null,
            draftId: opts.draftId || null,
            curationId: opts.curationId || null,
            curatorId: this._currentCuratorId(opts),
            capturedAt,
            // timestamp is retained for legacy ordering/prune callers.
            timestamp: capturedAt,
            language: opts.language || null,
            durationSeconds: opts.durationSeconds ?? opts.duration_seconds ?? null,
            transcriptionModel: opts.transcriptionModel || opts.transcription_model || opts.model || null,
            retryCount: 0,
            lastError: null,
            status: 'pending',
            isAdditional: opts.isAdditional || false,
            transcriptText: opts.transcriptText || null,
            transcriptPersisted: false,
            disposable: false,
            processingLeaseToken: null,
            processingLeaseOwner: null,
            processingLeaseExpiresAt: null
        };
        const id = await this.dataStorage.db.pendingAudio.add(row); this.prune().catch(() => {}); return id;
    }

    async getAudio(id) { return await this.dataStorage.db.pendingAudio.get(id); }

    async getBySourceId(sourceId) {
        if (!sourceId) return null;
        const table = this.dataStorage.db.pendingAudio;
        if (table.where) {
            try { const row = await table.where('sourceId').equals(sourceId).first(); if (row) return row; } catch (_) {}
        }
        const rows = await table.toArray(); return rows.find((row) => String(row?.sourceId || '') === String(sourceId)) || null;
    }

    async resolveAudio(idOrSourceId) {
        if (idOrSourceId === null || idOrSourceId === undefined) return null;
        if (typeof idOrSourceId === 'number') { const row = await this.getAudio(idOrSourceId); if (row) return row; }
        return await this.getBySourceId(idOrSourceId);
    }

    _matchesFilter(audio, filter = {}) {
        if (filter.restaurantId && audio?.restaurantId !== filter.restaurantId) return false;
        if (filter.draftId && audio?.draftId !== filter.draftId) return false;
        if (filter.curationId && audio?.curationId !== filter.curationId) return false;
        if (filter.status && audio?.status !== filter.status) return false;
        return true;
    }

    async getAudios(filter = {}) {
        const table = this.dataStorage.db.pendingAudio;
        try {
            let query = table;
            if (filter.restaurantId) query = query.where('restaurantId').equals(filter.restaurantId);
            else if (filter.draftId) query = query.where('draftId').equals(filter.draftId);
            else if (filter.curationId) query = query.where('curationId').equals(filter.curationId);
            else if (filter.status) query = query.where('status').equals(filter.status);
            return await query.toArray();
        } catch (error) {
            // Profiles created by the old manual DataStore fallback may not
            // have the new authoring indexes yet. Never turn that into an
            // empty result: scan the small pending-audio table in memory.
            this.log.warn('Pending audio index unavailable; falling back to scan:', error?.message || error);
            try {
                const rows = await table.toArray();
                return rows.filter((audio) => this._matchesFilter(audio, filter));
            } catch (fallbackError) {
                this.log.error('Error retrieving pending audios:', fallbackError);
                return [];
            }
        }
    }

    async updateAudio(id, updates) { await this.dataStorage.db.pendingAudio.update(id, updates); }

    async claimForProcessing(idOrSourceId, { ownerId = this.processingOwnerId, leaseMs = this.processingLeaseMs } = {}) {
        return this._withPendingAudioTransaction(async () => {
            const audio = await this.resolveAudio(idOrSourceId);
            if (!audio?.audioBlob || audio.id == null || audio.disposable === true) return null;

            const now = Date.now();
            if (this._leaseIsActive(audio, now)) return null;

            const sourceId = audio.sourceId || this._newSourceId();
            const capturedAt = audio.capturedAt || audio.timestamp || new Date();
            const curatorId = audio.curatorId || this._currentCuratorId();
            const processingLeaseToken = this._newLeaseToken();
            const processingLeaseOwner = String(ownerId || this.processingOwnerId);
            const processingLeaseExpiresAt = new Date(now + Math.max(1000, Number(leaseMs) || this.processingLeaseMs)).toISOString();
            const updates = {
                sourceId,
                capturedAt,
                curatorId,
                status: 'processing',
                processingStartedAt: new Date(now),
                processingLeaseToken,
                processingLeaseOwner,
                processingLeaseExpiresAt,
                lastError: null
            };
            await this.updateAudio(audio.id, updates);
            return { ...audio, ...updates };
        });
    }

    async markProcessingFailed(idOrSourceId, errorMessage, { leaseToken = null } = {}) {
        return this._withPendingAudioTransaction(async () => {
            const audio = await this.resolveAudio(idOrSourceId); if (!audio || audio.id == null) return false;
            this._assertLease(audio, leaseToken);
            await this.updateAudio(audio.id, {
                retryCount: (audio.retryCount || 0) + 1,
                status: 'failed',
                lastError: String(errorMessage?.message || errorMessage || 'Processing failed'),
                processingStartedAt: null,
                processingLeaseToken: null,
                processingLeaseOwner: null,
                processingLeaseExpiresAt: null
            });
            return true;
        });
    }

    async storeTranscript(idOrSourceId, transcriptText, metadata = {}) {
        return this._withPendingAudioTransaction(async () => {
            const audio = await this.resolveAudio(idOrSourceId); if (!audio || audio.id == null) throw new Error(`Pending audio ${idOrSourceId} not found`);
            this._assertLease(audio, metadata.leaseToken || null);
            const updates = {
                transcriptText: transcriptText || null,
                status: transcriptText ? 'transcribed' : audio.status,
                transcriptPersisted: false,
                disposable: false,
                lastError: null,
                ...(metadata.language ? { language: metadata.language } : {}),
                ...(metadata.durationSeconds !== undefined ? { durationSeconds: metadata.durationSeconds } : {}),
                ...((metadata.transcriptionModel || metadata.model) ? { transcriptionModel: metadata.transcriptionModel || metadata.model } : {})
            };
            await this.updateAudio(audio.id, updates);
            return { ...audio, ...updates, ...metadata };
        });
    }

    async associateWithCuration(filter, curationId) {
        if (!curationId) return 0; const audios = await this.getAudios(filter || {}); let updated = 0;
        for (const audio of audios) { if (audio?.id == null) continue; await this.updateAudio(audio.id, { curationId }); updated++; } return updated;
    }

    /** Two-phase commit: durable transcript first, then raw blob deletion. */
    async markTranscriptPersisted(idOrSourceId, { curationId = null, draftId = null, leaseToken = null } = {}) {
        return this._withPendingAudioTransaction(async () => {
            const audio = await this.resolveAudio(idOrSourceId); if (!audio || audio.id == null) throw new Error(`Pending audio ${idOrSourceId} not found`);
            this._assertLease(audio, leaseToken);
            await this.updateAudio(audio.id, {
                ...(curationId ? { curationId } : {}),
                ...(draftId ? { draftId } : {}),
                transcriptPersisted: true,
                disposable: true,
                status: 'completed',
                processingStartedAt: null,
                processingLeaseToken: null,
                processingLeaseOwner: null,
                processingLeaseExpiresAt: null,
                lastError: null
            });
            await this.deleteAudio(audio.id);
            return true;
        });
    }

    async incrementRetryCount(id, errorMessage) {
        const audio = await this.getAudio(id); if (!audio) throw new Error(`Pending audio ${id} not found`);
        const retryCount = (audio.retryCount || 0) + 1;
        await this.updateAudio(id, {
            retryCount,
            lastError: errorMessage,
            status: retryCount >= this.maxAutoRetries ? 'failed' : 'retrying',
            processingLeaseToken: null,
            processingLeaseOwner: null,
            processingLeaseExpiresAt: null
        });
        return retryCount;
    }

    async scheduleAutoRetry(id, retryCallback) {
        const audio = await this.getAudio(id); if (!audio) return; const retryCount = audio.retryCount || 0;
        if (retryCount >= this.maxAutoRetries) { await this.updateAudio(id, { status: 'failed' }); return; }
        const delay = this.retryDelays[retryCount] || this.retryDelays[this.retryDelays.length - 1];
        setTimeout(async () => {
            const latest = await this.getAudio(id).catch(() => null);
            if (!latest || latest.disposable === true) return;

            // Part 2 owns restart/reconnect processing. Delegate timer retries
            // to the same persistent-lease processor so one capture cannot be
            // transcribed concurrently by another tab or the legacy callback.
            if (typeof window !== 'undefined' && window.offlineCaptureProcessor?.processPending) {
                await window.offlineCaptureProcessor.processPending().catch((error) => {
                    this.log.warn('Durable audio retry failed:', error);
                });
                const updated = await this.getAudio(id).catch(() => null);
                if (updated && updated.disposable !== true && updated.retryCount < this.maxAutoRetries) {
                    await this.scheduleAutoRetry(id, retryCallback);
                }
                return;
            }

            try {
                await retryCallback(id, latest);
            } catch (error) {
                await this.incrementRetryCount(id, error.message);
                const updated = await this.getAudio(id);
                if (updated && updated.retryCount < this.maxAutoRetries) {
                    await this.scheduleAutoRetry(id, retryCallback);
                }
            }
        }, delay);
    }

    async canAutoRetry(id) { const audio = await this.getAudio(id).catch(() => null); return Boolean(audio && audio.status === 'failed' && audio.retryCount < this.maxAutoRetries); }
    async deleteAudio(id) { await this.dataStorage.db.pendingAudio.delete(id); }
    async deleteAudios(filter = {}) { try { const audios = await this.getAudios(filter); await Promise.all(audios.map((audio) => this.deleteAudio(audio.id))); return audios.length; } catch (_) { return 0; } }
    async markAsTranscribed(id, transcriptText = null) { await this.updateAudio(id, { status: 'transcribed', ...(transcriptText ? { transcriptText } : {}), lastError: null, transcriptPersisted: false, disposable: false }); }

    async getCount(status = null) { try { return status ? await this.dataStorage.db.pendingAudio.where('status').equals(status).count() : await this.dataStorage.db.pendingAudio.count(); } catch (_) { return 0; } }
    async getAudioCounts() {
        try { const statuses = ['pending', 'processing', 'failed', 'retrying', 'transcribed', 'completed']; const values = await Promise.all(statuses.map((status) => this.dataStorage.db.pendingAudio.where('status').equals(status).count())); return { ...Object.fromEntries(statuses.map((status, i) => [status, values[i]])), total: values.reduce((a, b) => a + b, 0) }; }
        catch (_) { return { pending: 0, processing: 0, failed: 0, retrying: 0, transcribed: 0, completed: 0, total: 0 }; }
    }

    async cleanupOldTranscribed(daysOld = 7) {
        try { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysOld); const rows = await this.dataStorage.db.pendingAudio.where('status').anyOf(['transcribed', 'completed']).and((audio) => this.canDeleteAudio(audio) && new Date(audio.timestamp) < cutoff).toArray(); await Promise.all(rows.map((audio) => this.deleteAudio(audio.id))); return rows.length; }
        catch (_) { return 0; }
    }
    async purgeProcessedAudio() {
        try { const rows = await this.dataStorage.db.pendingAudio.where('status').anyOf(['transcribed', 'completed']).toArray(); const disposable = rows.filter((audio) => this.canDeleteAudio(audio)); await Promise.all(disposable.map((audio) => this.deleteAudio(audio.id))); return disposable.length; }
        catch (_) { return 0; }
    }
});

if (typeof window !== 'undefined') {
    window.PendingAudioManager = new PendingAudioManager();
    if (typeof document !== 'undefined' && !document.querySelector('script[data-offline-durability]')) {
        const script = document.createElement('script'); script.src = 'scripts/modules/offlineDurabilityModule.js?v=20260830-1'; script.async = false; script.dataset.offlineDurability = 'true'; document.head.appendChild(script);
    }
}