/**
 * Pending Audio Manager Module
 *
 * Raw audio is authoritative until a durable textual source exists. Numeric
 * Dexie `id` is only the local blob locator; stable `sourceId` is the
 * provenance identity that survives processing, sync and device-local cleanup.
 */
const PendingAudioManager = ModuleWrapper.defineClass('PendingAudioManager', class {
    constructor() {
        this.log = Logger.module('PendingAudioManager');
        this.dataStorage = null;
        this.maxAutoRetries = 2;
        this.retryDelays = [5000, 15000];
    }

    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('PendingAudioManager initialized');
        this.prune().catch((error) => this.log.warn('prune no init falhou:', error));
    }

    canDeleteAudio(audio) {
        return Boolean(audio && audio.disposable === true);
    }

    async prune({ maxCount = 30, maxAgeDays = 7 } = {}) {
        try {
            const audios = await this.getAudios();
            const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
            const sorted = audios
                .filter((audio) => audio && audio.id != null)
                .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
            const toDelete = [];
            sorted.forEach((audio, index) => {
                if (!this.canDeleteAudio(audio)) return;
                const age = new Date(audio.timestamp || 0).getTime();
                if (age < cutoff || index >= maxCount) toDelete.push(audio.id);
            });
            for (const id of toDelete) await this.deleteAudio(id).catch(() => {});
            if (toDelete.length) this.log.debug(`Retenção de áudio: ${toDelete.length} gravações descartáveis removidas`);
        } catch (error) {
            this.log.error('Prune de áudios pendentes falhou:', error);
        }
    }

    _newSourceId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        } catch (_) {}
        return `audio_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    async saveAudio(audioBlob, options = {}) {
        try {
            let blob = audioBlob;
            let opts = options;
            if (audioBlob && !(audioBlob instanceof Blob) && audioBlob.audioBlob) {
                blob = audioBlob.audioBlob;
                opts = audioBlob;
            }
            const audioData = {
                sourceId: opts.sourceId || this._newSourceId(),
                audioBlob: blob,
                restaurantId: opts.restaurantId || null,
                draftId: opts.draftId || null,
                curationId: opts.curationId || null,
                timestamp: new Date(),
                retryCount: 0,
                lastError: null,
                status: 'pending',
                isAdditional: opts.isAdditional || false,
                transcriptText: opts.transcriptText || null,
                transcriptPersisted: false,
                disposable: false
            };
            const id = await this.dataStorage.db.pendingAudio.add(audioData);
            this.log.debug(`Pending audio saved with ID: ${id}, sourceId: ${audioData.sourceId}`);
            this.prune().catch((error) => this.log.warn('prune pós-save falhou:', error));
            return id;
        } catch (error) {
            this.log.error('Error saving pending audio:', error);
            throw error;
        }
    }

    async getAudio(id) {
        try {
            return await this.dataStorage.db.pendingAudio.get(id);
        } catch (error) {
            this.log.error('Error retrieving pending audio:', error);
            throw error;
        }
    }

    async getBySourceId(sourceId) {
        if (!sourceId) return null;
        try {
            const table = this.dataStorage.db.pendingAudio;
            if (table.where) {
                try {
                    const row = await table.where('sourceId').equals(sourceId).first();
                    if (row) return row;
                } catch (_) {
                    // Older schema may not index sourceId; scan below.
                }
            }
            const rows = await table.toArray();
            return rows.find((row) => String(row?.sourceId || '') === String(sourceId)) || null;
        } catch (error) {
            this.log.error('Error retrieving pending audio by sourceId:', error);
            return null;
        }
    }

    async resolveAudio(idOrSourceId) {
        if (idOrSourceId === null || idOrSourceId === undefined) return null;
        if (typeof idOrSourceId === 'number') {
            const byId = await this.getAudio(idOrSourceId);
            if (byId) return byId;
        }
        return await this.getBySourceId(idOrSourceId);
    }

    async getAudios(filter = {}) {
        try {
            let query = this.dataStorage.db.pendingAudio;
            if (filter.restaurantId) query = query.where('restaurantId').equals(filter.restaurantId);
            else if (filter.draftId) query = query.where('draftId').equals(filter.draftId);
            else if (filter.curationId) query = query.where('curationId').equals(filter.curationId);
            else if (filter.status) query = query.where('status').equals(filter.status);
            return await query.toArray();
        } catch (error) {
            this.log.error('Error retrieving pending audios:', error);
            return [];
        }
    }

    async updateAudio(id, updates) {
        try {
            await this.dataStorage.db.pendingAudio.update(id, updates);
            this.log.debug(`Pending audio ${id} updated`);
        } catch (error) {
            this.log.error('Error updating pending audio:', error);
            throw error;
        }
    }

    async claimForProcessing(idOrSourceId) {
        const audio = await this.resolveAudio(idOrSourceId);
        if (!audio || audio.id == null || !audio.audioBlob || audio.disposable === true) return null;
        await this.updateAudio(audio.id, {
            status: 'processing',
            processingStartedAt: new Date(),
            lastError: null
        });
        return { ...audio, status: 'processing' };
    }

    async markProcessingFailed(idOrSourceId, errorMessage) {
        const audio = await this.resolveAudio(idOrSourceId);
        if (!audio || audio.id == null) return false;
        const retryCount = (audio.retryCount || 0) + 1;
        await this.updateAudio(audio.id, {
            retryCount,
            status: 'failed',
            lastError: String(errorMessage?.message || errorMessage || 'Processing failed'),
            processingStartedAt: null
        });
        return true;
    }

    async storeTranscript(idOrSourceId, transcriptText) {
        const audio = await this.resolveAudio(idOrSourceId);
        if (!audio || audio.id == null) throw new Error(`Pending audio ${idOrSourceId} not found`);
        await this.updateAudio(audio.id, {
            transcriptText: transcriptText || null,
            status: transcriptText ? 'transcribed' : audio.status,
            transcriptPersisted: false,
            disposable: false,
            lastError: null
        });
        return { ...audio, transcriptText: transcriptText || null };
    }

    async associateWithCuration(filter, curationId) {
        if (!curationId) return 0;
        const audios = await this.getAudios(filter || {});
        let updated = 0;
        for (const audio of audios) {
            if (!audio || audio.id == null) continue;
            await this.updateAudio(audio.id, { curationId });
            updated++;
        }
        return updated;
    }

    async markTranscriptPersisted(idOrSourceId, { curationId = null, draftId = null } = {}) {
        const audio = await this.resolveAudio(idOrSourceId);
        if (!audio || audio.id == null) throw new Error(`Pending audio ${idOrSourceId} not found`);
        await this.updateAudio(audio.id, {
            ...(curationId ? { curationId } : {}),
            ...(draftId ? { draftId } : {}),
            transcriptPersisted: true,
            disposable: true,
            status: 'completed',
            processingStartedAt: null,
            lastError: null
        });
    }

    async incrementRetryCount(id, errorMessage) {
        const audio = await this.getAudio(id);
        if (!audio) throw new Error(`Pending audio ${id} not found`);
        const newRetryCount = (audio.retryCount || 0) + 1;
        await this.updateAudio(id, {
            retryCount: newRetryCount,
            lastError: errorMessage,
            status: newRetryCount >= this.maxAutoRetries ? 'failed' : 'retrying'
        });
        return newRetryCount;
    }

    async scheduleAutoRetry(id, retryCallback) {
        try {
            const audio = await this.getAudio(id);
            if (!audio) return;
            const retryCount = audio.retryCount || 0;
            if (retryCount >= this.maxAutoRetries) {
                await this.updateAudio(id, { status: 'failed' });
                return;
            }
            const delay = this.retryDelays[retryCount] || this.retryDelays[this.retryDelays.length - 1];
            setTimeout(async () => {
                try {
                    const latest = await this.getAudio(id);
                    if (!latest || latest.disposable === true) return;
                    // Pass both local id and row; legacy RecordingModule expects both.
                    await retryCallback(id, latest);
                } catch (error) {
                    await this.incrementRetryCount(id, error.message);
                    const updated = await this.getAudio(id);
                    if (updated && updated.retryCount < this.maxAutoRetries) await this.scheduleAutoRetry(id, retryCallback);
                }
            }, delay);
        } catch (error) {
            this.log.error('Error scheduling auto retry:', error);
        }
    }

    async canAutoRetry(id) {
        try {
            const audio = await this.getAudio(id);
            return Boolean(audio && audio.status === 'failed' && audio.retryCount < this.maxAutoRetries);
        } catch (_) {
            return false;
        }
    }

    async deleteAudio(id) {
        await this.dataStorage.db.pendingAudio.delete(id);
        this.log.debug(`Pending audio ${id} deleted`);
    }

    async deleteAudios(filter = {}) {
        try {
            const audios = await this.getAudios(filter);
            await Promise.all(audios.map((audio) => this.deleteAudio(audio.id)));
            return audios.length;
        } catch (error) {
            this.log.error('Error deleting pending audios:', error);
            return 0;
        }
    }

    async markAsTranscribed(id, transcriptText = null) {
        await this.updateAudio(id, {
            status: 'transcribed',
            ...(transcriptText ? { transcriptText } : {}),
            lastError: null,
            transcriptPersisted: false,
            disposable: false
        });
    }

    async getCount(status = null) {
        try {
            if (status) return await this.dataStorage.db.pendingAudio.where('status').equals(status).count();
            return await this.dataStorage.db.pendingAudio.count();
        } catch (_) {
            return 0;
        }
    }

    async getAudioCounts() {
        try {
            const statuses = ['pending', 'processing', 'failed', 'retrying', 'transcribed', 'completed'];
            const values = await Promise.all(statuses.map((status) => this.dataStorage.db.pendingAudio.where('status').equals(status).count()));
            const result = Object.fromEntries(statuses.map((status, index) => [status, values[index]]));
            result.total = values.reduce((sum, value) => sum + value, 0);
            return result;
        } catch (_) {
            return { pending: 0, processing: 0, failed: 0, retrying: 0, transcribed: 0, completed: 0, total: 0 };
        }
    }

    async cleanupOldTranscribed(daysOld = 7) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const oldAudios = await this.dataStorage.db.pendingAudio
                .where('status').anyOf(['transcribed', 'completed'])
                .and((audio) => this.canDeleteAudio(audio) && new Date(audio.timestamp) < cutoffDate)
                .toArray();
            await Promise.all(oldAudios.map((audio) => this.deleteAudio(audio.id)));
            return oldAudios.length;
        } catch (_) {
            return 0;
        }
    }

    async purgeProcessedAudio() {
        try {
            const processedAudios = await this.dataStorage.db.pendingAudio.where('status').anyOf(['transcribed', 'completed']).toArray();
            const disposable = processedAudios.filter((audio) => this.canDeleteAudio(audio));
            await Promise.all(disposable.map((audio) => this.deleteAudio(audio.id)));
            return disposable.length;
        } catch (_) {
            return 0;
        }
    }
});

if (typeof window !== 'undefined') {
    window.PendingAudioManager = new PendingAudioManager();
    if (typeof document !== 'undefined' && !document.querySelector('script[data-offline-durability]')) {
        const script = document.createElement('script');
        script.src = 'scripts/modules/offlineDurabilityModule.js?v=20260830-1';
        script.async = false;
        script.dataset.offlineDurability = 'true';
        document.head.appendChild(script);
    }
}
