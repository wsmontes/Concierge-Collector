/**
 * Pending Audio Manager Module
 * 
 * Purpose: Manages audio recordings that are waiting for transcription or have failed transcription.
 * Handles storage, retrieval, retry logic, and cleanup of pending audio data.
 * 
 * Main Responsibilities:
 * - Store audio blobs in IndexedDB with metadata
 * - Implement automatic retry logic (2 attempts with exponential backoff)
 * - Provide manual retry functionality
 * - Track transcription status and error states
 * - Clean up audio after successful transcription and restaurant save
 * 
 * Dependencies: dataStorage (window.dataStorage)
 */

const PendingAudioManager = ModuleWrapper.defineClass('PendingAudioManager', class {
    constructor() {
        // Create module logger instance
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
    }

    /**
     * Save audio recording to pending storage
     * @param {Object} data - Audio data
     * @param {Blob} data.audioBlob - The audio blob
     * @param {number} data.restaurantId - Restaurant ID (optional)
     * @param {number} data.draftId - Draft restaurant ID (optional)
     * @param {boolean} data.isAdditional - Is this an additional recording?
     * @returns {Promise<number>} - Pending audio ID
     */
    async saveAudio(data) {
        try {
            const audioData = {
                audioBlob: data.audioBlob,
                restaurantId: data.restaurantId || null,
                draftId: data.draftId || null,
                timestamp: new Date(),
                retryCount: 0,
                lastError: null,
                status: 'pending',
                isAdditional: data.isAdditional || false
            };

            const id = await this.dataStorage.db.pendingAudio.add(audioData);
            this.log.debug(`Pending audio saved with ID: ${id}`);
            
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
            const audio = await this.dataStorage.db.pendingAudio.get(id);
            return audio;
        } catch (error) {
            this.log.error('Error retrieving pending audio:', error);
            throw error;
        }
    }

    /**
     * Get all pending audios, optionally filtered
     * @param {Object} filter - Filter options
     * @param {number} filter.restaurantId - Filter by restaurant ID
     * @param {number} filter.draftId - Filter by draft ID
     * @param {string} filter.status - Filter by status
     * @returns {Promise<Array>} - Array of pending audio records
     */
    async getAudios(filter = {}) {
        try {
            let query = this.dataStorage.db.pendingAudio;

            if (filter.restaurantId) {
                query = query.where('restaurantId').equals(filter.restaurantId);
            } else if (filter.draftId) {
                query = query.where('draftId').equals(filter.draftId);
            } else if (filter.status) {
                query = query.where('status').equals(filter.status);
            }

            const audios = await query.toArray();
            return audios;
        } catch (error) {
            this.log.error('Error retrieving pending audios:', error);
            return [];
        }
    }

    /**
     * Update pending audio record
     * @param {number} id - Pending audio ID
     * @param {Object} updates - Data to update
     * @returns {Promise<void>}
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
     * Increment retry count and update last error
     * @param {number} id - Pending audio ID
     * @param {string} errorMessage - Error message
     * @returns {Promise<number>} - New retry count
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
     * @param {number} id - Pending audio ID
     * @param {Function} retryCallback - Function to call for retry
     * @returns {Promise<void>}
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
                    
                    // Schedule next retry if not maxed out
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
     * @param {number} id - Pending audio ID
     * @returns {Promise<boolean>} - True if can retry
     */
    async canAutoRetry(id) {
        try {
            const audio = await this.getAudio(id);
            if (!audio) return false;
            
            // Can retry if status is failed and retry count is below max
            return audio.status === 'failed' && audio.retryCount < this.maxAutoRetries;
        } catch (error) {
            this.log.error('Error checking auto retry eligibility:', error);
            return false;
        }
    }

    /**
     * Delete pending audio record
     * @param {number} id - Pending audio ID
     * @returns {Promise<void>}
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
     * Delete multiple pending audios by filter
     * @param {Object} filter - Filter options (restaurantId, draftId, etc.)
     * @returns {Promise<number>} - Number of deleted records
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
     * Mark audio as successfully transcribed
     * @param {number} id - Pending audio ID
     * @returns {Promise<void>}
     */
    async markAsTranscribed(id) {
        try {
            await this.updateAudio(id, {
                status: 'transcribed',
                lastError: null
            });
            this.log.debug(`Pending audio ${id} marked as transcribed`);
        } catch (error) {
            this.log.error('Error marking audio as transcribed:', error);
            throw error;
        }
    }

    /**
     * Get count of pending audios by status
     * @param {string} status - Status filter (optional)
     * @returns {Promise<number>} - Count of matching records
     */
    async getCount(status = null) {
        try {
            if (status) {
                return await this.dataStorage.db.pendingAudio.where('status').equals(status).count();
            } else {
                return await this.dataStorage.db.pendingAudio.count();
            }
        } catch (error) {
            this.log.error('Error getting pending audio count:', error);
            return 0;
        }
    }

    /**
     * Get counts of pending audios by all statuses
     * @returns {Promise<Object>} - Object with counts by status
     */
    async getAudioCounts() {
        try {
            const [pending, processing, failed, retrying, transcribed] = await Promise.all([
                this.dataStorage.db.pendingAudio.where('status').equals('pending').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('processing').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('failed').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('retrying').count(),
                this.dataStorage.db.pendingAudio.where('status').equals('transcribed').count()
            ]);

            return {
                pending,
                processing,
                failed,
                retrying,
                transcribed,
                total: pending + processing + failed + retrying + transcribed
            };
        } catch (error) {
            this.log.error('Error getting pending audio counts:', error);
            return {
                pending: 0,
                processing: 0,
                failed: 0,
                retrying: 0,
                transcribed: 0,
                total: 0
            };
        }
    }

    /**
     * Clean up old transcribed audios (for maintenance)
     * @param {number} daysOld - Days old to consider for cleanup
     * @returns {Promise<number>} - Number of cleaned up records
     */
    async cleanupOldTranscribed(daysOld = 7) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const oldTranscribed = await this.dataStorage.db.pendingAudio
                .where('status').equals('transcribed')
                .and(audio => new Date(audio.timestamp) < cutoffDate)
                .toArray();

            const deletePromises = oldTranscribed.map(audio => this.deleteAudio(audio.id));
            await Promise.all(deletePromises);

            this.log.debug(`Cleaned up ${oldTranscribed.length} old transcribed audios`);
            return oldTranscribed.length;
        } catch (error) {
            this.log.error('Error cleaning up old transcribed audios:', error);
            return 0;
        }
    }
});

// Create and expose global instance
if (typeof window !== 'undefined') {
    window.PendingAudioManager = new PendingAudioManager();
}
