/**
 * Draft Restaurant Manager Module
 *
 * Durable authoring-session storage for incomplete/new/edited Curations.
 * A curator may have many independent drafts at once; curatorId is ownership
 * metadata, never the identity of "the current draft".
 *
 * Dependencies: dataStorage (window.dataStorage)
 */

const DraftRestaurantManager = ModuleWrapper.defineClass('DraftRestaurantManager', class {
    constructor() {
        this.log = Logger.module('DraftRestaurantManager');
        this.dataStorage = null;
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 3000;
        this.currentDraftId = null;
        this.currentSessionId = null;
        this.pendingAutoSave = null;
    }

    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('DraftRestaurantManager initialized');
    }

    _newSessionId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
        } catch (_) {}
        return `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    _parseMetadata(draft) {
        if (!draft?.metadata) return {};
        try {
            return JSON.parse(draft.metadata) || {};
        } catch (error) {
            this.log.warn('Error parsing draft metadata:', error);
            return {};
        }
    }

    _serializeMetadata(data, currentDraft = null) {
        return JSON.stringify({
            concepts: data.concepts !== undefined ? data.concepts : (currentDraft?.concepts || []),
            location: data.location !== undefined ? data.location : (currentDraft?.location || null),
            photos: data.photos !== undefined ? data.photos : (currentDraft?.photos || []),
            notes: data.notes !== undefined
                ? data.notes
                : (currentDraft?.notes || { public: '', private: '' })
        });
    }

    /**
     * Create one independent authoring session.
     * @param {string|number} curatorId
     * @param {Object} data
     * @param {Object} options
     * @returns {Promise<number>}
     */
    async createDraft(curatorId, data = {}, options = {}) {
        try {
            const sessionId = options.sessionId || data.sessionId || this._newSessionId();
            const draftData = {
                curatorId,
                sessionId,
                targetCurationId: options.targetCurationId || data.targetCurationId || null,
                targetEntityId: options.targetEntityId || data.targetEntityId || null,
                savedCurationId: options.savedCurationId || data.savedCurationId || null,
                preservedForMedia: Boolean(options.preservedForMedia || data.preservedForMedia),
                name: data.name || '',
                timestamp: new Date(),
                lastModified: new Date(),
                hasAudio: Boolean(data.hasAudio),
                transcription: data.transcription || '',
                description: data.description || '',
                metadata: this._serializeMetadata(data)
            };

            const id = await this.dataStorage.db.draftRestaurants.add(draftData);
            this.currentDraftId = id;
            this.currentSessionId = sessionId;
            this.log.debug(`Draft authoring session created: ${sessionId} (ID ${id})`);
            return id;
        } catch (error) {
            this.log.error('Error creating draft restaurant:', error);
            throw error;
        }
    }

    async getDraft(draftId) {
        try {
            const draft = await this.dataStorage.db.draftRestaurants.get(draftId);
            if (!draft) return null;
            const metadata = this._parseMetadata(draft);
            return {
                ...draft,
                concepts: metadata.concepts || [],
                location: metadata.location || null,
                photos: metadata.photos || [],
                notes: metadata.notes || { public: '', private: '' }
            };
        } catch (error) {
            this.log.error('Error retrieving draft restaurant:', error);
            throw error;
        }
    }

    async getDrafts(curatorId = null) {
        try {
            let drafts;
            if (curatorId) {
                drafts = await this.dataStorage.db.draftRestaurants
                    .where('curatorId').equals(curatorId)
                    .toArray();
            } else {
                drafts = await this.dataStorage.db.draftRestaurants.toArray();
            }

            return drafts.map((draft) => {
                const metadata = this._parseMetadata(draft);
                return {
                    ...draft,
                    concepts: metadata.concepts || [],
                    location: metadata.location || null,
                    photos: metadata.photos || [],
                    notes: metadata.notes || { public: '', private: '' }
                };
            });
        } catch (error) {
            this.log.error('Error retrieving draft restaurants:', error);
            return [];
        }
    }

    async updateDraft(draftId, data = {}) {
        try {
            const updates = { lastModified: new Date() };

            if (data.name !== undefined) updates.name = data.name;
            if (data.transcription !== undefined) updates.transcription = data.transcription;
            if (data.description !== undefined) updates.description = data.description;
            if (data.hasAudio !== undefined) updates.hasAudio = data.hasAudio;
            if (data.sessionId !== undefined) updates.sessionId = data.sessionId;
            if (data.targetCurationId !== undefined) updates.targetCurationId = data.targetCurationId;
            if (data.targetEntityId !== undefined) updates.targetEntityId = data.targetEntityId;
            if (data.savedCurationId !== undefined) updates.savedCurationId = data.savedCurationId;
            if (data.preservedForMedia !== undefined) updates.preservedForMedia = Boolean(data.preservedForMedia);

            const metadataChanged =
                data.concepts !== undefined ||
                data.location !== undefined ||
                data.photos !== undefined ||
                data.notes !== undefined;

            if (metadataChanged) {
                const currentDraft = await this.getDraft(draftId);
                updates.metadata = this._serializeMetadata(data, currentDraft);
            }

            await this.dataStorage.db.draftRestaurants.update(draftId, updates);
            this.log.debug(`Draft ${draftId} updated`);
        } catch (error) {
            this.log.error('Error updating draft restaurant:', error);
            throw error;
        }
    }

    /**
     * Debounced autosave. The pending payload is retained so lifecycle edges
     * can flush synchronously to IndexedDB before the page is frozen/killed.
     */
    async autoSaveDraft(draftId, data) {
        if (this.autoSaveTimeout) clearTimeout(this.autoSaveTimeout);

        const token = {};
        this.pendingAutoSave = { draftId, data, token };
        this.autoSaveTimeout = setTimeout(async () => {
            const pending = this.pendingAutoSave;
            if (!pending || pending.token !== token) return;
            try {
                await this.updateDraft(pending.draftId, pending.data);
                this.log.debug(`Auto-saved draft ${pending.draftId}`);
            } catch (error) {
                this.log.error('Error auto-saving draft:', error);
            } finally {
                if (this.pendingAutoSave?.token === token) {
                    this.pendingAutoSave = null;
                    this.autoSaveTimeout = null;
                }
            }
        }, this.autoSaveDelay);
    }

    async flushPendingSave() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }
        const pending = this.pendingAutoSave;
        this.pendingAutoSave = null;
        if (!pending) return false;

        await this.updateDraft(pending.draftId, pending.data);
        this.log.debug(`Flushed pending draft ${pending.draftId}`);
        return true;
    }

    clearCurrentDraft() {
        this.currentDraftId = null;
        this.currentSessionId = null;
    }

    hasData(draft) {
        if (!draft) return false;
        const notes = draft.notes || {};
        return Boolean(
            draft.name?.trim() ||
            draft.transcription?.trim() ||
            draft.description?.trim() ||
            notes.public?.trim?.() ||
            notes.private?.trim?.() ||
            (draft.concepts && draft.concepts.length > 0) ||
            draft.location ||
            (draft.photos && draft.photos.length > 0) ||
            draft.hasAudio
        );
    }

    getCompletionPercentage(draft) {
        if (!draft) return 0;
        const fields = {
            name: Boolean(draft.name?.trim()),
            transcription: Boolean(draft.transcription?.trim()),
            concepts: Boolean(draft.concepts?.length),
            location: Boolean(draft.location),
            photos: Boolean(draft.photos?.length)
        };
        const completed = Object.values(fields).filter(Boolean).length;
        return Math.round((completed / Object.keys(fields).length) * 100);
    }

    /**
     * Delete draft metadata. Raw audio is intentionally NOT deleted here:
     * draft lifecycle and raw-source lifecycle are separate durability axes.
     * Explicit recording deletion lives in PendingAudioManager/UI.
     */
    async deleteDraft(draftId) {
        try {
            await this.flushPendingSave().catch(() => {});
            await this.dataStorage.db.draftRestaurants.delete(draftId);
            this.log.debug(`Draft ${draftId} deleted`);

            if (this.currentDraftId === draftId) {
                this.clearCurrentDraft();
            }
        } catch (error) {
            this.log.error('Error deleting draft restaurant:', error);
            throw error;
        }
    }

    async cleanupOldDrafts(daysOld = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const allDrafts = await this.getDrafts();
            const oldEmptyDrafts = allDrafts.filter((draft) =>
                !draft.preservedForMedia &&
                new Date(draft.lastModified) < cutoffDate &&
                !this.hasData(draft)
            );

            for (const draft of oldEmptyDrafts) {
                await this.deleteDraft(draft.id);
            }

            this.log.debug(`Cleaned up ${oldEmptyDrafts.length} old empty drafts`);
            return oldEmptyDrafts.length;
        } catch (error) {
            this.log.error('Error cleaning up old drafts:', error);
            return 0;
        }
    }

    draftToRestaurantData(draft) {
        return {
            name: draft.name || '',
            concepts: draft.concepts || [],
            location: draft.location || null,
            photos: draft.photos || [],
            transcription: draft.transcription || '',
            description: draft.description || '',
            notes: draft.notes || { public: '', private: '' },
            targetCurationId: draft.targetCurationId || null,
            targetEntityId: draft.targetEntityId || null
        };
    }

    /**
     * Resolve only an explicitly active/session-targeted draft. The old
     * implementation selected "most recent for curator", which allowed a new
     * Curation to silently inherit an unrelated unfinished item.
     */
    async getOrCreateCurrentDraft(curatorId, options = {}) {
        try {
            const requestedSessionId = options.sessionId || null;
            const requestedTargetCurationId = options.targetCurationId || null;
            const requestedTargetEntityId = options.targetEntityId || null;

            if (this.currentDraftId) {
                const current = await this.getDraft(this.currentDraftId);
                const currentMatches = Boolean(
                    current &&
                    current.curatorId === curatorId &&
                    (!requestedSessionId || current.sessionId === requestedSessionId) &&
                    (!requestedTargetCurationId || current.targetCurationId === requestedTargetCurationId)
                );
                if (currentMatches) {
                    this.currentSessionId = current.sessionId || requestedSessionId || null;
                    return this.currentDraftId;
                }
            }

            const drafts = await this.getDrafts(curatorId);
            let match = null;
            if (requestedSessionId) {
                match = drafts.find((draft) => draft.sessionId === requestedSessionId) || null;
            }
            if (!match && requestedTargetCurationId) {
                match = drafts.find((draft) => draft.targetCurationId === requestedTargetCurationId) || null;
            }

            if (match) {
                this.currentDraftId = match.id;
                this.currentSessionId = match.sessionId || requestedSessionId || null;
                return match.id;
            }

            return await this.createDraft(curatorId, {}, {
                sessionId: requestedSessionId || this._newSessionId(),
                targetCurationId: requestedTargetCurationId,
                targetEntityId: requestedTargetEntityId
            });
        } catch (error) {
            this.log.error('Error getting or creating draft:', error);
            throw error;
        }
    }
});

if (typeof window !== 'undefined') {
    window.DraftRestaurantManager = new DraftRestaurantManager();
}
