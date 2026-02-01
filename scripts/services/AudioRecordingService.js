/**
 * Audio Recording Service - Core audio recording functionality
 * 
 * Purpose: Handles MediaRecorder API, stream management, and audio chunk collection
 * 
 * Main Responsibilities:
 * - Start/stop audio recording
 * - Manage media streams
 * - Collect audio chunks
 * - Handle browser compatibility
 * - Validate recording state
 * 
 * Dependencies: audioUtils, errorHandling
 * 
 * Usage:
 * const service = new AudioRecordingService();
 * await service.startRecording({ isAdditional: false });
 * const blob = await service.stopRecording();
 */

class AudioRecordingService {
    constructor() {
        this.log = Logger.module('AudioRecordingService');
        
        // Recording state
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.audioChunks = [];
        this.isRecording = false;
        
        // Configuration
        this.maxDuration = 5 * 60 * 1000; // 5 minutes
        this.chunkInterval = 1000; // 1 second chunks
        
        // Validate dependencies
        if (!window.audioUtils) {
            throw new Error('audioUtils not loaded');
        }
        if (!window.errorHandling) {
            throw new Error('errorHandling not loaded');
        }
    }
    
    /**
     * Check if browser supports audio recording
     * @returns {Object} - {supported: boolean, error: string}
     */
    checkBrowserSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return {
                supported: false,
                error: 'Audio recording not supported in this browser'
            };
        }
        
        if (typeof MediaRecorder === 'undefined') {
            return {
                supported: false,
                error: 'MediaRecorder API not available'
            };
        }
        
        return { supported: true, error: null };
    }
    
    /**
     * Get audio constraints optimized for recording
     * @param {boolean} enhanced - Use enhanced constraints
     * @returns {Object} - MediaStream constraints
     */
    getAudioConstraints(enhanced = true) {
        return window.audioUtils.getAudioConstraints(enhanced);
    }
    
    /**
     * Get best supported MIME type for recording
     * @returns {string|null} - MIME type or null
     */
    getBestMimeType() {
        return window.audioUtils.getBestSupportedMimeType();
    }
    
    /**
     * Request microphone access and get media stream
     * @param {Object} constraints - Audio constraints
     * @returns {Promise<MediaStream>}
     */
    async getMediaStream(constraints = null) {
        // Fail-fast: check browser support first
        const supportCheck = this.checkBrowserSupport();
        if (!supportCheck.supported) {
            const error = new Error(supportCheck.error);
            this.log.error('❌ Browser does not support audio recording');
            throw error;
        }
        
        const finalConstraints = constraints || this.getAudioConstraints(true);
        
        try {
            this.log.debug('Requesting microphone access with constraints:', finalConstraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);
            
            if (!stream || !stream.getTracks().length) {
                throw new Error('No audio tracks in media stream');
            }
            
            this.log.debug('✅ Media stream obtained successfully', {
                tracks: stream.getTracks().length,
                constraints: finalConstraints
            });
            return stream;
            
        } catch (error) {
            this.log.error('Error getting media stream:', error);
            
            // Provide user-friendly error messages
            if (error.name === 'NotAllowedError') {
                throw new Error('Microphone access denied. Please allow microphone access in your browser settings.');
            } else if (error.name === 'NotFoundError') {
                throw new Error('No microphone found. Please connect a microphone and try again.');
            } else if (error.name === 'NotReadableError') {
                throw new Error('Microphone is in use by another application.');
            } else {
                throw new Error(`Microphone error: ${error.message}`);
            }
        }
    }
    
    /**
     * Release media stream and stop all tracks
     */
    releaseMediaStream() {
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(track => {
                    track.stop();
                    this.log.debug('Track stopped:', track.label);
                });
                this.mediaStream = null;
                this.log.debug('Media stream released');
            } catch (error) {
                this.log.error('Error releasing media stream:', error);
            }
        }
    }
    
    /**
     * Create and configure MediaRecorder
     * @param {MediaStream} stream - Media stream from getUserMedia
     * @returns {MediaRecorder}
     */
    createMediaRecorder(stream) {
        // Get best MIME type
        const mimeType = this.getBestMimeType();
        
        // Build recorder options
        const options = {};
        if (mimeType) {
            options.mimeType = mimeType;
        }
        options.audioBitsPerSecond = 128000; // 128kbps
        
        this.log.debug('Creating MediaRecorder with options:', options);
        
        try {
            return new MediaRecorder(stream, options);
        } catch (error) {
            this.log.warn('Error creating MediaRecorder with options, trying without:', error);
            // Fallback: let browser use default
            return new MediaRecorder(stream);
        }
    }
    
    /**
     * Handle data available event from MediaRecorder
     * @param {BlobEvent} event - Data available event
     */
    handleDataAvailable(event) {
        if (event.data && event.data.size > 0) {
            this.audioChunks.push(event.data);
            this.log.debug(`Audio chunk collected: ${event.data.size} bytes`);
        }
    }
    
    /**
     * Start audio recording
     * @param {Object} options - Recording options {isAdditional, maxDuration}
     * @returns {Promise<void>}
     */
    async startRecording(options = {}) {
        const { isAdditional = false, maxDuration = this.maxDuration } = options;
        
        return await window.errorHandling.safeExecute(
            async () => {
                // Check if already recording
                if (this.isRecording) {
                    throw new Error('Recording already in progress');
                }
                
                // Check browser support
                const supportCheck = this.checkBrowserSupport();
                if (!supportCheck.supported) {
                    throw new Error(supportCheck.error);
                }
                
                this.log.debug('Starting recording, isAdditional:', isAdditional);
                
                // Get media stream
                this.mediaStream = await this.getMediaStream();
                
                // Create MediaRecorder
                this.mediaRecorder = this.createMediaRecorder(this.mediaStream);
                
                // Clear previous chunks
                this.audioChunks = [];
                
                // Set up event handlers
                this.mediaRecorder.ondataavailable = (event) => {
                    this.handleDataAvailable(event);
                };
                
                this.mediaRecorder.onerror = (error) => {
                    this.log.error('MediaRecorder error:', error);
                };
                
                // Start recording with chunk interval
                this.mediaRecorder.start(this.chunkInterval);
                this.isRecording = true;
                
                this.log.debug('Recording started successfully');
                
                // Safety auto-stop after max duration
                setTimeout(() => {
                    if (this.isRecording) {
                        this.log.warn('Auto-stopping recording due to max duration');
                        this.stopRecording().catch(err => {
                            this.log.error('Error auto-stopping recording:', err);
                        });
                    }
                }, maxDuration);
                
            },
            'Start recording',
            { showError: true, throwError: true }
        );
    }
    
    /**
     * Stop audio recording and return blob
     * @returns {Promise<Blob>} - Recorded audio blob
     */
    async stopRecording() {
        return await window.errorHandling.safeExecute(
            async () => {
                // Fail-fast: check recording state
                if (!this.isRecording || !this.mediaRecorder) {
                    const error = new Error('No active recording to stop');
                    this.log.warn('⚠️ Attempted to stop recording but none active');
                    throw error;
                }
                
                // Check recorder state
                if (this.mediaRecorder.state === 'inactive') {
                    this.log.warn('⚠️ MediaRecorder already inactive');
                    throw new Error('MediaRecorder already stopped');
                }
                
                this.log.debug('🛑 Stopping recording...', {
                    state: this.mediaRecorder.state,
                    chunksCollected: this.audioChunks.length
                });
                if (this.mediaRecorder.state === 'inactive') {
                    throw new Error('MediaRecorder already inactive');
                }
                
                this.log.debug('Stopping recording...');
                
                // Wait for stop event
                return new Promise((resolve, reject) => {
                    // Set up stop handler
                    this.mediaRecorder.onstop = () => {
                        try {
                            // Create blob from chunks
                            const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
                            const blob = window.audioUtils.createAudioBlob(
                                this.audioChunks,
                                mimeType
                            );
                            
                            // Validate blob
                            const validation = window.audioUtils.validateAudioBlob(blob);
                            if (!validation.valid) {
                                throw new Error(validation.error);
                            }
                            
                            this.log.debug('Recording stopped successfully:', {
                                size: window.audioUtils.formatSize(blob.size),
                                type: blob.type,
                                chunks: this.audioChunks.length
                            });
                            
                            // Release resources
                            this.releaseMediaStream();
                            this.isRecording = false;
                            
                            resolve(blob);
                            
                        } catch (error) {
                            this.log.error('Error in stop handler:', error);
                            reject(error);
                        }
                    };
                    
                    // Stop recording
                    try {
                        this.mediaRecorder.stop();
                    } catch (error) {
                        reject(error);
                    }
                });
            },
            'Stop recording',
            { showError: true, throwError: true }
        );
    }
    
    /**
     * Get current recording blob without stopping
     * @returns {Blob|null} - Current audio blob or null
     */
    getCurrentBlob() {
        if (!this.isRecording || this.audioChunks.length === 0) {
            return null;
        }
        
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        return window.audioUtils.createAudioBlob(this.audioChunks, mimeType);
    }
    
    /**
     * Clear audio chunks without stopping recording
     */
    clearChunks() {
        this.audioChunks = [];
        this.log.debug('Audio chunks cleared');
    }
    
    /**
     * Get recording duration in seconds
     * @returns {number} - Recording duration in seconds
     */
    getRecordingDuration() {
        if (!this.audioChunks.length) return 0;
        
        // Estimate duration based on chunk count and interval
        return (this.audioChunks.length * this.chunkInterval) / 1000;
    }
    
    /**
     * Check if currently recording
     * @returns {boolean}
     */
    isRecordingActive() {
        return this.isRecording && 
               this.mediaRecorder && 
               this.mediaRecorder.state === 'recording';
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.log.debug('Cleaning up AudioRecordingService');
        
        try {
            if (this.isRecording && this.mediaRecorder) {
                this.mediaRecorder.stop();
            }
        } catch (error) {
            this.log.error('Error stopping recorder during cleanup:', error);
        }
        
        this.releaseMediaStream();
        this.audioChunks = [];
        this.isRecording = false;
    }
}

// Export for use
window.AudioRecordingService = AudioRecordingService;
console.debug('[AudioRecordingService] Service initialized');
