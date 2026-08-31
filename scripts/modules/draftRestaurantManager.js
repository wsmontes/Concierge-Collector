/**
 * Draft Restaurant Manager Module
 *
 * Durable authoring-session storage for incomplete/new/edited Curations.
 * A curator may have many independent drafts at once; curatorId is ownership
 * metadata, never the identity of "the current draft".
 */
const DraftRestaurantManager = ModuleWrapper.defineClass('DraftRestaurantManager', class {
    constructor() {
        this.log = Logger.module('DraftRestaurantManager');
        this.dataStorage = null;
        this.autoSaveDelay = 3000;
        this.currentDraftId = null;
        this.currentSessionId = null;
        // Autosave is keyed by durable draft identity. Independent drafts must
        // never cancel or overwrite each other's pending writes.
        this.pendingAutoSaves = new Map();
    }

    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('DraftRestaurantManager initialized');
    }

    _newSessionId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
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
            notes: data.notes !== undefined ? data.notes : (currentDraft?.notes || { public: '', private: '' }),
            voiceSources: data.voiceSources !== undefined ? data.voiceSources : (currentDraft?.voiceSources || [])
        });
    }

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
            return id;
        } catch (error) {
            this.log.error('Error creating draft restaurant:', error);
            throw error;
        }
    }

    async getDraft(draftId) {
        const draft = await this.dataStorage.db.draftRestaurants.get(draftId);
        if (!draft) return null;
        const metadata = this._parseMetadata(draft);
        return {
            ...draft,
            concepts: metadata.concepts || [],
            location: metadata.location || null,
            photos: metadata.photos || [],
            notes: metadata.notes || { public: '', private: '' },
            voiceSources: metadata.voiceSources || []
        };
    }

    async getDrafts(curatorId = null) {
        try {
            const drafts = curatorId
                ? await this.dataStorage.db.draftRestaurants.where('curatorId').equals(curatorId).toArray()
                : await this.dataStorage.db.draftRestaurants.toArray();
            return drafts.map((draft) => {
                const metadata = this._parseMetadata(draft);
                return {
                    ...draft,
                    concepts: metadata.concepts || [],
                    location: metadata.location || null,
                    photos: metadata.photos || [],
                    notes: metadata.notes || { public: '', private: '' },
                    voiceSources: metadata.voiceSources || []
                };
            });
        } catch (error) {
            this.log.error('Error retrieving draft restaurants:', error);
            return [];
        }
    }

    async updateDraft(draftId, data = {}) {
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

        const metadataChanged = ['concepts', 'location', 'photos', 'notes', 'voiceSources']
            .some((key) => data[key] !== undefined);
        if (metadataChanged) {
            const currentDraft = await this.getDraft(draftId);
            updates.metadata = this._serializeMetadata(data, currentDraft);
        }
        await this.dataStorage.db.draftRestaurants.update(draftId, updates);
    }

    async autoSaveDraft(draftId, data) {
        if (draftId === null || draftId === undefined) return false;

        const previous = this.pendingAutoSaves.get(draftId);
        if (previous?.timeout) clearTimeout(previous.timeout);

        const token = {};
        const pending = { draftId, data, token, timeout: null };
        pending.timeout = setTimeout(async () => {
            const current = this.pendingAutoSaves.get(draftId);
            if (!current || current.token !== token) return;
            try {
                await this.updateDraft(current.draftId, current.data);
            } catch (error) {
                this.log.error('Error auto-saving draft:', error);
            } finally {
                const latest = this.pendingAutoSaves.get(draftId);
                if (latest?.token === token) this.pendingAutoSaves.delete(draftId);
            }
        }, this.autoSaveDelay);

        this.pendingAutoSaves.set(draftId, pending);
        return true;
    }

    async flushPendingSave(draftId = null) {
        const entries = draftId === null || draftId === undefined
            ? [...this.pendingAutoSaves.entries()]
            : (this.pendingAutoSaves.has(draftId)
                ? [[draftId, this.pendingAutoSaves.get(draftId)]]
                : []);
        if (!entries.length) return false;

        for (const [id, pending] of entries) {
            if (pending?.timeout) clearTimeout(pending.timeout);
            // Delete before awaiting I/O so a new autosave scheduled while the
            // flush is in flight gets a fresh entry rather than being erased.
            if (this.pendingAutoSaves.get(id)?.token === pending.token) {
                this.pendingAutoSaves.delete(id);
            }
        }

        await Promise.all(entries.map(([, pending]) =>
            this.updateDraft(pending.draftId, pending.data)
        ));
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
            draft.name?.trim() || draft.transcription?.trim() || draft.description?.trim() ||
            notes.public?.trim?.() || notes.private?.trim?.() ||
            draft.concepts?.length || draft.location || draft.photos?.length ||
            draft.voiceSources?.length || draft.hasAudio
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
        return Math.round((Object.values(fields).filter(Boolean).length / Object.keys(fields).length) * 100);
    }

    async deleteDraft(draftId) {
        // Flush only the draft being deleted. Other draft sessions retain
        // their independent debounce state and can still be flushed later.
        await this.flushPendingSave(draftId).catch(() => {});
        await this.dataStorage.db.draftRestaurants.delete(draftId);
        if (this.currentDraftId === draftId) this.clearCurrentDraft();
    }

    async cleanupOldDrafts(daysOld = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const allDrafts = await this.getDrafts();
            const oldEmptyDrafts = allDrafts.filter((draft) =>
                !draft.preservedForMedia && new Date(draft.lastModified) < cutoffDate && !this.hasData(draft)
            );
            for (const draft of oldEmptyDrafts) await this.deleteDraft(draft.id);
            return oldEmptyDrafts.length;
        } catch (_) {
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
            voiceSources: draft.voiceSources || [],
            targetCurationId: draft.targetCurationId || null,
            targetEntityId: draft.targetEntityId || null
        };
    }

    async getOrCreateCurrentDraft(curatorId, options = {}) {
        const requestedSessionId = options.sessionId || null;
        const requestedTargetCurationId = options.targetCurationId || null;
        const requestedTargetEntityId = options.targetEntityId || null;

        if (this.currentDraftId) {
            const current = await this.getDraft(this.currentDraftId);
            const currentMatches = Boolean(
                current && current.curatorId === curatorId &&
                (!requestedSessionId || current.sessionId === requestedSessionId) &&
                (!requestedTargetCurationId || current.targetCurationId === requestedTargetCurationId)
            );
            if (currentMatches) return this.currentDraftId;
        }

        const drafts = await this.getDrafts(curatorId);
        let match = null;
        if (requestedSessionId) match = drafts.find((draft) => draft.sessionId === requestedSessionId) || null;
        if (!match && requestedTargetCurationId) match = drafts.find((draft) => draft.targetCurationId === requestedTargetCurationId) || null;
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
    }
});

if (typeof window !== 'undefined') window.DraftRestaurantManager = new DraftRestaurantManager();
