/**
 * Pending Audio Manager Module
 *
 * Purpose: Manages audio recordings that are waiting for transcription or have failed transcription.
 * Handles storage, retrieval, retry logic, and cleanup of pending audio data.
 *
 * Offline-first durability rule (2026-08-30): raw audio is the user's source
 * material and MUST NOT be reclaimed by age/count/status alone. A row becomes
 * automatically deletable only after a durable processed representation has
 * explicitly been persisted (`disposable === true`). Explicit user deletion
 * remains allowed through deleteAudio/deleteAudios.
 *
 * Dependencies: dataStorage (window.dataStorage)
 */

const PendingAudioManager = ModuleWrapper.defineClass('PendingAudioManager', class {
    constructor() {
        this.log = Logger.module('PendingAudioManager');

        this.dataStorage = null;
        this.maxAutoRetries = 2;
        this.retryDelays = [5000, 15000]; // 5s, 15s
    }

    /**
     * Initialize the pending audio manager
     * @param {Object} dataStorage - DataStorage instance
     */
    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('PendingAudioManager initialized');
        // Safe maintenance: prune() is allowed to reclaim only rows that
        // have already been made disposable by an explicit durability step.
        this.prune().catch((error) => this.log.warn('prune no init falhou:', error));
    }

    /**
     * Central deletion predicate for AUTOMATIC cleanup.
     * Age, count and a status such as "completed" are not proof that the
     * transcript/source representation survived a Curation save.
     * @param {Object} audio
     * @returns {boolean}
     */
    canDeleteAudio(audio) {
        return Boolean(audio && audio.disposable === true);
    }

    /**
     * Safe local retention. Limits apply only to recordings that are already
     * disposable. Required raw recordings are never deleted due to age/count.
     * @param {Object} options
     * @param {number} options.maxCount - Preferred maximum retained rows
     * @param {number} options.maxAgeDays - Preferred maximum age in days
     */
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
                if (age < cutoff || index >= maxCount) {
                    toDelete.push(audio.id);
                }
            });

            for (const id of toDelete) {
                await this.deleteAudio(id).catch(() => {});
            }
            if (toDelete.length) {
                this.log.debug(`Retenção de áudio: ${toDelete.length} gravações descartáveis removidas`);
            }
        } catch (error) {
            this.log.error('Prune de áudios pendentes falhou:', error);
        }
    }

    _newSourceId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
        } catch (_) {}
        return `audio_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    /**
     * Save audio recording to pending storage.
     * Raw audio is non-disposable by default.
     * @param {Blob} audioBlob - The audio blob
     * @param {Object} options - Additional options
     * @returns {Promise<number>} - Pending audio ID
     */
    async saveAudio(audioBlob, options = {}) {
        try {
            // Support both: saveAudio(blob, opts) and legacy saveAudio({audioBlob, ...})
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
                transcriptPersisted: false,
                disposable: false
            };

            const id = await this.dataStorage.db.pendingAudio.add(audioData);
            this.log.debug(`Pending audio saved with ID: ${id}`);

            // Safe fire-and-forget maintenance. Non-disposable rows survive.
            this.prune().catch((error) => this.log.warn('prune pós-save falhou:', error));

            return id;
        } catch (error) {
            this.log.error('Error saving pending audio:', error);
            throw error;
        }
    }

    /**
     * Get pending audio by ID
     * @param {number} id - Pending audio ID
     * @returns {Promise<Object>} - Pending audio data
     */
    async getAudio(id) {
        try {
            return await this.dataStorage.db.pendingAudio.get(id);
        } catch (error) {
            this.log.error('Error retrieving pending audio:', error);
            throw error;
        }
    }

    /**
     * Get all pending audios, optionally filtered.
     */
    async getAudios(filter = {}) {
        try {
            let query = this.dataStorage.db.pendingAudio;

            if (filter.restaurantId) {
                query = query.where('restaurantId').equals(filter.restaurantId);
            } else if (filter.draftId) {
                query = query.where('draftId').equals(filter.draftId);
            } else if (filter.curationId) {
                query = query.where('curationId').equals(filter.curationId);
            } else if (filter.status) {
                query = query.where('status').equals(filter.status);
            }

            return await query.toArray();
        } catch (error) {
            this.log.error('Error retrieving pending audios:', error);
            return [];
        }
    }

    /**
     * Update pending audio record
     */
    async updateAudio(id, updates) {
        try {
            await this.dataStorage.db.pendingAudio.update(id, updates);
            this.log.debug(`Pending audio ${id} updated`);
        } catch (error) {
            this.log.error('Error updating pending audio:', error);
            throw error;
        }
    }

    /**
     * Associate existing raw sources with the durable Curation produced by a
     * Save. Association is deliberately non-destructive.
     * @param {Object} filter - draftId/restaurantId/curationId filter
     * @param {string} curationId
     * @returns {Promise<number>}
     */
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

    /**
     * Confirm that the transcript represented by this raw audio has been
     * durably persisted. This is the ONLY automatic path that makes raw audio
     * disposable.
     * @param {number} id
     * @param {Object} options
     * @param {string|null} options.curationId
     */
    async markTranscriptPersisted(id, { curationId = null } = {}) {
        const audio = await this.getAudio(id);
        if (!audio) {
            throw new Error(`Pending audio ${id} not found`);
        }
        await this.updateAudio(id, {
            ...(curationId ? { curationId } : {}),
            transcriptPersisted: true,
            disposable: true,
            status: 'completed',
            lastError: null
        });
    }

    /**
     * Increment retry count and update last error
     */
    async incrementRetryCount(id, errorMessage) {
        try {
            const audio = await this.getAudio(id);
            if (!audio) {
                throw new Error(`Pending audio ${id} not found`);
            }

            const newRetryCount = (audio.retryCount || 0) + 1;
            await this.updateAudio(id, {
                retryCount: newRetryCount,
                lastError: errorMessage,
                status: newRetryCount >= this.maxAutoRetries ? 'failed' : 'retrying'
            });

            this.log.debug(`Pending audio ${id} retry count: ${newRetryCount}`);
            return newRetryCount;
        } catch (error) {
            this.log.error('Error incrementing retry count:', error);
            throw error;
        }
    }

    /**
     * Schedule automatic retry for failed transcription
     */
    async scheduleAutoRetry(id, retryCallback) {
        try {
            const audio = await this.getAudio(id);
            if (!audio) {
                this.log.error(`Cannot schedule retry: pending audio ${id} not found`);
                return;
            }

            const retryCount = audio.retryCount || 0;

            if (retryCount >= this.maxAutoRetries) {
                this.log.debug(`Max retries reached for pending audio ${id}, marking as failed`);
                await this.updateAudio(id, { status: 'failed' });
                return;
            }

            const delay = this.retryDelays[retryCount] || this.retryDelays[this.retryDelays.length - 1];
            this.log.debug(`Scheduling retry ${retryCount + 1} for pending audio ${id} in ${delay}ms`);

            setTimeout(async () => {
                try {
                    this.log.debug(`Executing retry ${retryCount + 1} for pending audio ${id}`);
                    await retryCallback(id);
                } catch (error) {
                    this.log.error(`Retry ${retryCount + 1} failed for pending audio ${id}:`, error);
                    await this.incrementRetryCount(id, error.message);

                    const updatedAudio = await this.getAudio(id);
                    if (updatedAudio && updatedAudio.retryCount < this.maxAutoRetries) {
                        await this.scheduleAutoRetry(id, retryCallback);
                    }
                }
            }, delay);
        } catch (error) {
            this.log.error('Error scheduling auto retry:', error);
        }
    }

    /**
     * Check if audio can be automatically retried
     */
    async canAutoRetry(id) {
        try {
            const audio = await this.getAudio(id);
            if (!audio) return false;
            return audio.status === 'failed' && audio.retryCount < this.maxAutoRetries;
        } catch (error) {
            this.log.error('Error checking auto retry eligibility:', error);
            return false;
        }
    }

    /**
     * Explicit user deletion. Unlike automatic cleanup, this intentionally
     * does not require disposable=true.
     */
    async deleteAudio(id) {
        try {
            await this.dataStorage.db.pendingAudio.delete(id);
            this.log.debug(`Pending audio ${id} deleted`);
        } catch (error) {
            this.log.error('Error deleting pending audio:', error);
            throw error;
        }
    }

    /**
     * Explicit bulk deletion by filter (used by user-driven management UI).
     */
    async deleteAudios(filter = {}) {
        try {
            const audios = await this.getAudios(filter);
            const deletePromises = audios.map(audio => this.deleteAudio(audio.id));
            await Promise.all(deletePromises);

            this.log.debug(`Deleted ${audios.length} pending audio records`);
            return audios.length;
        } catch (error) {
            this.log.error('Error deleting pending audios:', error);
            return 0;
        }
    }

    /**
     * Legacy compatibility marker. Transcription success alone does NOT make
     * raw audio disposable because the transcript may still live only in DOM.
     */
    async markAsTranscribed(id) {
        try {
            await this.updateAudio(id, {
                status: 'transcribed',
                lastError: null,
                transcriptPersisted: false,
                disposable: false
            });
            this.log.debug(`Pending audio ${id} marked as transcribed (raw retained)`);
        } catch (error) {
            this.log.error('Error marking audio as transcribed:', error);
            throw error;
        }
    }

    async getCount(status = null) {
        try {
            if (status) {
                return await this.dataStorage.db.pendingAudio.where('status').equals(status).count();
            }
            return await this.dataStorage.db.pendingAudio.count();
        } catch (error) {
            this.log.error('Error getting pending audio count:', error);
            return 0;
        }
    }

    async getAudioCounts() {
        try {
            const [pending, processing, failed, retrying, transcribed, completed] = await Promise.all([
                this.dataStorage.db.pendingAudio.where('status').equals('pending').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('processing').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('failed').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('retrying').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('transcribed').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('completed').count()
            ]);

            return {
                pending,
                processing,
                failed,
                retrying,
                transcribed,
                completed,
                total: pending + processing + failed + retrying + transcribed + completed
            };
        } catch (error) {
            this.log.error('Error getting pending audio counts:', error);
            return {
                pending: 0,
                processing: 0,
                failed: 0,
                retrying: 0,
                transcribed: 0,
                completed: 0,
                total: 0
            };
        }
    }

    /**
     * Clean up old processed audios only after they are disposable.
     */
    async cleanupOldTranscribed(daysOld = 7) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const oldAudios = await this.dataStorage.db.pendingAudio
                .where('status').anyOf(['transcribed', 'completed'])
                .and(audio => this.canDeleteAudio(audio) && new Date(audio.timestamp) < cutoffDate)
                .toArray();

            const deletePromises = oldAudios.map(audio => this.deleteAudio(audio.id));
            await Promise.all(deletePromises);

            this.log.debug(`Cleaned up ${oldAudios.length} disposable processed audios`);
            return oldAudios.length;
        } catch (error) {
            this.log.error('Error cleaning up old processed audios:', error);
            return 0;
        }
    }

    /**
     * Purge processed audio that has explicitly become disposable.
     */
    async purgeProcessedAudio() {
        try {
            const processedAudios = await this.dataStorage.db.pendingAudio
                .where('status').anyOf(['transcribed', 'completed'])
                .toArray();
            const disposable = processedAudios.filter(audio => this.canDeleteAudio(audio));

            const deletePromises = disposable.map(audio => this.deleteAudio(audio.id));
            await Promise.all(deletePromises);

            this.log.info(`Purged ${disposable.length} disposable processed audio records`);
            return disposable.length;
        } catch (error) {
            this.log.error('Error purging processed audio:', error);
            return 0;
        }
    }
});

if (typeof window !== 'undefined') {
    window.PendingAudioManager = new PendingAudioManager();
}
