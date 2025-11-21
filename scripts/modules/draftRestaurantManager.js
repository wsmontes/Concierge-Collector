/**
 * Draft Restaurant Manager Module
 * 
 * Purpose: Manages incomplete/draft restaurant data that hasn't been saved yet.
 * Provides auto-save functionality and draft persistence across sessions.
 * 
 * Main Responsibilities:
 * - Store draft restaurant data with any metadata (name, transcription, concepts, etc.)
 * - Auto-save draft data with debouncing
 * - Load and restore draft data when user returns
 * - Track draft completion status
 * - Clean up drafts when restaurants are saved
 * 
 * Dependencies: dataStorage (window.dataStorage)
 */

const DraftRestaurantManager = ModuleWrapper.defineClass('DraftRestaurantManager', class {
    constructor() {
        // Create module logger instance
        this.log = Logger.module('DraftRestaurantManager');
        
        this.dataStorage = null;
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 3000; // 3 seconds
        this.currentDraftId = null;
    }

    /**
     * Initialize the draft restaurant manager
     * @param {Object} dataStorage - DataStorage instance
     */
    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('DraftRestaurantManager initialized');
        this.log.debug('DataStorage type:', typeof dataStorage);
        this.log.debug('DataStorage.db:', dataStorage ? dataStorage.db : 'dataStorage is null');
        this.log.debug('DataStorage.db.draftRestaurants:', dataStorage && dataStorage.db ? dataStorage.db.draftRestaurants : 'db is null/undefined');
    }

    /**
     * Create a new draft restaurant
     * @param {number} curatorId - Curator ID
     * @param {Object} data - Initial draft data
     * @returns {Promise<number>} - Draft ID
     */
    async createDraft(curatorId, data = {}) {
        try {
            const draftData = {
                curatorId: curatorId,
                name: data.name || '',
                timestamp: new Date(),
                lastModified: new Date(),
                hasAudio: false,
                transcription: data.transcription || '',
                description: data.description || '',
                // Store additional data as JSON
                metadata: JSON.stringify({
                    concepts: data.concepts || [],
                    location: data.location || null,
                    photos: data.photos || []
                })
            };

            const id = await this.dataStorage.db.draftRestaurants.add(draftData);
            this.currentDraftId = id;
            this.log.debug(`Draft restaurant created with ID: ${id}`);
            
            return id;
        } catch (error) {
            this.log.error('Error creating draft restaurant:', error);
            throw error;
        }
    }

    /**
     * Get draft restaurant by ID
     * @param {number} draftId - Draft ID
     * @returns {Promise<Object>} - Draft restaurant data with parsed metadata
     */
    async getDraft(draftId) {
        try {
            const draft = await this.dataStorage.db.draftRestaurants.get(draftId);
            if (!draft) {
                return null;
            }

            // Parse metadata
            let metadata = {};
            if (draft.metadata) {
                try {
                    metadata = JSON.parse(draft.metadata);
                } catch (e) {
                    this.log.warn('Error parsing draft metadata:', e);
                }
            }

            return {
                ...draft,
                concepts: metadata.concepts || [],
                location: metadata.location || null,
                photos: metadata.photos || []
            };
        } catch (error) {
            this.log.error('Error retrieving draft restaurant:', error);
            throw error;
        }
    }

    /**
     * Get all draft restaurants for a curator
     * @param {number} curatorId - Curator ID
     * @returns {Promise<Array>} - Array of draft restaurants
     */
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

            // Parse metadata for each draft
            return drafts.map(draft => {
                let metadata = {};
                if (draft.metadata) {
                    try {
                        metadata = JSON.parse(draft.metadata);
                    } catch (e) {
                        this.log.warn('Error parsing draft metadata:', e);
                    }
                }

                return {
                    ...draft,
                    concepts: metadata.concepts || [],
                    location: metadata.location || null,
                    photos: metadata.photos || []
                };
            });
        } catch (error) {
            this.log.error('Error retrieving draft restaurants:', error);
            return [];
        }
    }

    /**
     * Update draft restaurant data
     * @param {number} draftId - Draft ID
     * @param {Object} data - Data to update
     * @returns {Promise<void>}
     */
    async updateDraft(draftId, data) {
        try {
            const updates = {
                lastModified: new Date()
            };

            // Handle simple fields
            if (data.name !== undefined) updates.name = data.name;
            if (data.transcription !== undefined) updates.transcription = data.transcription;
            if (data.description !== undefined) updates.description = data.description;
            if (data.hasAudio !== undefined) updates.hasAudio = data.hasAudio;

            // Handle metadata fields
            if (data.concepts || data.location || data.photos) {
                const currentDraft = await this.getDraft(draftId);
                const metadata = {
                    concepts: data.concepts !== undefined ? data.concepts : (currentDraft?.concepts || []),
                    location: data.location !== undefined ? data.location : (currentDraft?.location || null),
                    photos: data.photos !== undefined ? data.photos : (currentDraft?.photos || [])
                };
                updates.metadata = JSON.stringify(metadata);
            }

            await this.dataStorage.db.draftRestaurants.update(draftId, updates);
            this.log.debug(`Draft ${draftId} updated`);
        } catch (error) {
            this.log.error('Error updating draft restaurant:', error);
            throw error;
        }
    }

    /**
     * Auto-save draft data with debouncing
     * @param {number} draftId - Draft ID
     * @param {Object} data - Data to save
     * @returns {Promise<void>}
     */
    async autoSaveDraft(draftId, data) {
        // Clear existing timeout
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        // Set new timeout
        this.autoSaveTimeout = setTimeout(async () => {
            try {
                await this.updateDraft(draftId, data);
                this.log.debug(`Auto-saved draft ${draftId}`);
            } catch (error) {
                this.log.error('Error auto-saving draft:', error);
            }
        }, this.autoSaveDelay);
    }

    /**
     * Check if draft has any meaningful data
     * @param {Object} draft - Draft restaurant data
     * @returns {boolean} - True if draft has data
     */
    hasData(draft) {
        if (!draft) return false;

        // Check if any field has data
        return !!(
            draft.name?.trim() ||
            draft.transcription?.trim() ||
            draft.description?.trim() ||
            (draft.concepts && draft.concepts.length > 0) ||
            draft.location ||
            (draft.photos && draft.photos.length > 0) ||
            draft.hasAudio
        );
    }

    /**
     * Calculate draft completion percentage
     * @param {Object} draft - Draft restaurant data
     * @returns {number} - Completion percentage (0-100)
     */
    getCompletionPercentage(draft) {
        if (!draft) return 0;

        const fields = {
            name: !!draft.name?.trim(),
            transcription: !!draft.transcription?.trim(),
            concepts: draft.concepts && draft.concepts.length > 0,
            location: !!draft.location,
            photos: draft.photos && draft.photos.length > 0
        };

        const completed = Object.values(fields).filter(Boolean).length;
        const total = Object.keys(fields).length;

        return Math.round((completed / total) * 100);
    }

    /**
     * Delete draft restaurant
     * @param {number} draftId - Draft ID
     * @returns {Promise<void>}
     */
    async deleteDraft(draftId) {
        try {
            // Also delete associated pending audios
            if (window.PendingAudioManager) {
                await window.PendingAudioManager.deleteAudios({ draftId });
            }

            await this.dataStorage.db.draftRestaurants.delete(draftId);
            this.log.debug(`Draft ${draftId} deleted`);

            if (this.currentDraftId === draftId) {
                this.currentDraftId = null;
            }
        } catch (error) {
            this.log.error('Error deleting draft restaurant:', error);
            throw error;
        }
    }

    /**
     * Clean up empty drafts older than specified days
     * @param {number} daysOld - Days old to consider for cleanup
     * @returns {Promise<number>} - Number of cleaned up drafts
     */
    async cleanupOldDrafts(daysOld = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const allDrafts = await this.dataStorage.db.draftRestaurants.toArray();
            const oldEmptyDrafts = allDrafts.filter(draft => 
                new Date(draft.lastModified) < cutoffDate && !this.hasData(draft)
            );

            const deletePromises = oldEmptyDrafts.map(draft => this.deleteDraft(draft.id));
            await Promise.all(deletePromises);

            this.log.debug(`Cleaned up ${oldEmptyDrafts.length} old empty drafts`);
            return oldEmptyDrafts.length;
        } catch (error) {
            this.log.error('Error cleaning up old drafts:', error);
            return 0;
        }
    }

    /**
     * Convert draft to restaurant data format
     * @param {Object} draft - Draft restaurant data
     * @returns {Object} - Restaurant data ready for saving
     */
    draftToRestaurantData(draft) {
        return {
            name: draft.name || '',
            concepts: draft.concepts || [],
            location: draft.location || null,
            photos: draft.photos || [],
            transcription: draft.transcription || '',
            description: draft.description || ''
        };
    }

    /**
     * Get or create current draft for a curator
     * @param {number} curatorId - Curator ID
     * @returns {Promise<number>} - Draft ID
     */
    async getOrCreateCurrentDraft(curatorId) {
        try {
            // Check if we already have a current draft ID
            if (this.currentDraftId) {
                const draft = await this.getDraft(this.currentDraftId);
                if (draft && draft.curatorId === curatorId) {
                    return this.currentDraftId;
                }
            }

            // Find the most recent draft for this curator
            const drafts = await this.getDrafts(curatorId);
            if (drafts.length > 0) {
                // Sort by lastModified and get the most recent
                drafts.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
                this.currentDraftId = drafts[0].id;
                return this.currentDraftId;
            }

            // Create a new draft if none exist
            this.currentDraftId = await this.createDraft(curatorId);
            return this.currentDraftId;
        } catch (error) {
            this.log.error('Error getting or creating draft:', error);
            throw error;
        }
    }
});

// Create and expose global instance
if (typeof window !== 'undefined') {
    window.DraftRestaurantManager = new DraftRestaurantManager();
}
