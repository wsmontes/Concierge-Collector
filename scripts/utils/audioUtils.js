/**
 * Audio Utilities - Centralized audio processing helpers
 * 
 * Purpose: Provides reusable audio conversion, validation, and blob manipulation utilities
 * 
 * Main Responsibilities:
 * - Blob to Base64 conversion
 * - Audio format validation
 * - MIME type detection and normalization
 * - Audio file size checking
 * - Browser audio support detection
 * 
 * Dependencies: None (pure utility functions)
 */

window.audioUtils = {
    /**
     * Maximum audio file size (25MB - OpenAI Whisper limit)
     */
    MAX_AUDIO_SIZE: 25 * 1024 * 1024,
    
    /**
     * Supported audio MIME types in order of preference
     */
    SUPPORTED_MIME_TYPES: [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/mpeg',
        'audio/mp3',
        'audio/wav'
    ],
    
    /**
     * Convert blob to base64 string
     * @param {Blob} blob - Audio blob to convert
     * @returns {Promise<string>} - Base64 encoded audio (without data URL prefix)
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            if (!blob) {
                reject(new Error('No blob provided'));
                return;
            }
            
            const reader = new FileReader();
            reader.onloadend = () => {
                try {
                    // Get the base64 part without the data URL prefix
                    const base64String = reader.result.split(',')[1];
                    resolve(base64String);
                } catch (error) {
                    reject(new Error('Failed to extract base64 from blob: ' + error.message));
                }
            };
            reader.onerror = () => reject(new Error('FileReader error'));
            reader.readAsDataURL(blob);
        });
    },
    
    /**
     * Convert base64 string to blob
     * @param {string} base64 - Base64 encoded audio
     * @param {string} mimeType - MIME type for the blob
     * @returns {Blob} - Audio blob
     */
    base64ToBlob(base64, mimeType = 'audio/mp3') {
        // Remove data URL prefix if present
        const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
        
        // Decode base64
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    },
    
    /**
     * Validate audio blob
     * @param {Blob} blob - Audio blob to validate
     * @returns {Object} - Validation result {valid: boolean, error: string}
     */
    validateAudioBlob(blob) {
        if (!blob) {
            return { valid: false, error: 'No audio blob provided' };
        }
        
        if (!(blob instanceof Blob)) {
            return { valid: false, error: 'Invalid blob type' };
        }
        
        if (blob.size === 0) {
            return { valid: false, error: 'Audio blob is empty' };
        }
        
        if (blob.size > this.MAX_AUDIO_SIZE) {
            const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
            return { 
                valid: false, 
                error: `Audio file too large (${sizeMB}MB). Maximum: 25MB` 
            };
        }
        
        if (!blob.type || !blob.type.startsWith('audio/')) {
            return { 
                valid: false, 
                error: `Invalid audio MIME type: ${blob.type}` 
            };
        }
        
        return { valid: true, error: null };
    },
    
    /**
     * Get best supported MIME type for recording
     * @returns {string|null} - Best supported MIME type or null
     */
    getBestSupportedMimeType() {
        for (const mimeType of this.SUPPORTED_MIME_TYPES) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                console.debug(`[audioUtils] Selected MIME type: ${mimeType}`);
                return mimeType;
            }
        }
        
        console.warn('[audioUtils] No explicit MIME type support detected');
        return null;
    },
    
    /**
     * Normalize MIME type to standard format
     * @param {string} mimeType - MIME type to normalize
     * @returns {string} - Normalized MIME type
     */
    normalizeMimeType(mimeType) {
        if (!mimeType) return 'audio/mp3';
        
        const normalized = mimeType.toLowerCase().trim();
        
        // Map common variations to standard types
        const mimeMap = {
            'audio/mpeg': 'audio/mp3',
            'audio/mpeg3': 'audio/mp3',
            'audio/x-mpeg-3': 'audio/mp3',
            'audio/webm;codecs=opus': 'audio/webm',
            'audio/ogg;codecs=opus': 'audio/ogg'
        };
        
        return mimeMap[normalized] || normalized;
    },
    
    /**
     * Check if browser is iOS Safari (requires special audio handling)
     * @returns {boolean}
     */
    isIOSSafari() {
        const userAgent = navigator.userAgent;
        return /iPad|iPhone|iPod/.test(userAgent) && 
               !window.MSStream && 
               /Safari/.test(userAgent);
    },
    
    /**
     * Check if MediaRecorder API is supported
     * @returns {boolean}
     */
    isMediaRecorderSupported() {
        return typeof MediaRecorder !== 'undefined' && 
               navigator.mediaDevices && 
               navigator.mediaDevices.getUserMedia;
    },
    
    /**
     * Get audio constraints for recording
     * @param {boolean} enhanced - Whether to use enhanced constraints
     * @returns {Object} - MediaStream constraints
     */
    getAudioConstraints(enhanced = true) {
        if (this.isIOSSafari()) {
            // iOS Safari requires simple constraints
            return { audio: true };
        }
        
        if (enhanced) {
            return {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100
                }
            };
        }
        
        return { audio: true };
    },
    
    /**
     * Format audio duration from seconds
     * @param {number} seconds - Duration in seconds
     * @returns {string} - Formatted duration (MM:SS)
     */
    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },
    
    /**
     * Format audio file size
     * @param {number} bytes - Size in bytes
     * @returns {string} - Formatted size (KB/MB)
     */
    formatSize(bytes) {
        if (!bytes || isNaN(bytes)) return '0 KB';
        
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }
    },
    
    /**
     * Create audio blob from chunks with proper MIME type
     * @param {Array} chunks - Audio chunks
     * @param {string} mimeType - Desired MIME type
     * @returns {Blob} - Audio blob
     */
    createAudioBlob(chunks, mimeType = 'audio/webm') {
        if (!chunks || chunks.length === 0) {
            throw new Error('No audio chunks provided');
        }
        
        return new Blob(chunks, { type: mimeType });
    },
    
    /**
     * Get file extension from MIME type
     * @param {string} mimeType - MIME type
     * @returns {string} - File extension (without dot)
     */
    getExtensionFromMimeType(mimeType) {
        const extensionMap = {
            'audio/mp3': 'mp3',
            'audio/mpeg': 'mp3',
            'audio/webm': 'webm',
            'audio/ogg': 'ogg',
            'audio/wav': 'wav',
            'audio/mp4': 'm4a'
        };
        
        const normalized = this.normalizeMimeType(mimeType);
        return extensionMap[normalized] || 'mp3';
    }
};

console.debug('[audioUtils] Audio utilities initialized');
