/**
 * Audio Conversion Service - Strategy-based audio format conversion
 * 
 * Purpose: Converts audio between formats using pluggable conversion strategies
 * 
 * Main Responsibilities:
 * - Convert audio to different formats (MP3, Opus, WebM, WAV)
 * - Strategy pattern for extensibility
 * - Fallback chain for conversion failures
 * - Audio validation and size checking
 * 
 * Dependencies: audioUtils, errorHandling
 * 
 * Usage:
 * const service = new AudioConversionService();
 * const mp3Blob = await service.convert(webmBlob, 'mp3');
 */

class AudioConversionService {
    constructor() {
        this.log = Logger.module('AudioConversionService');
        
        // Conversion strategies registry
        this.strategies = new Map();
        
        // Register default strategies
        this.registerDefaultStrategies();
        
        // Validate dependencies
        if (!window.audioUtils) {
            throw new Error('audioUtils not loaded');
        }
        if (!window.errorHandling) {
            throw new Error('errorHandling not loaded');
        }
    }
    
    /**
     * Register default conversion strategies
     */
    registerDefaultStrategies() {
        // MP3 conversion strategy
        this.registerStrategy('mp3', async (blob) => {
            return await this.convertToMP3(blob);
        });
        
        // Opus conversion strategy
        this.registerStrategy('opus', async (blob) => {
            return await this.convertToOpus(blob);
        });
        
        // WebM strategy (passthrough or re-encode)
        this.registerStrategy('webm', async (blob) => {
            if (blob.type.includes('webm')) {
                return blob; // Already WebM
            }
            return await this.convertToWebM(blob);
        });
        
        // WAV conversion strategy
        this.registerStrategy('wav', async (blob) => {
            return await this.convertToWAV(blob);
        });
    }
    
    /**
     * Register a custom conversion strategy
     * @param {string} format - Target format (mp3, opus, webm, wav)
     * @param {Function} strategyFn - Async function(blob) => convertedBlob
     */
    registerStrategy(format, strategyFn) {
        this.strategies.set(format.toLowerCase(), strategyFn);
        this.log.debug(`Registered conversion strategy: ${format}`);
    }
    
    /**
     * Convert audio blob to target format
     * @param {Blob} blob - Source audio blob
     * @param {string} targetFormat - Target format (mp3, opus, webm, wav)
     * @param {Object} options - Conversion options
     * @returns {Promise<Blob>} - Converted audio blob
     */
    async convert(blob, targetFormat = 'mp3', options = {}) {
        return await window.errorHandling.safeExecute(
            async () => {
                // Validate input
                const validation = window.audioUtils.validateAudioBlob(blob);
                if (!validation.valid) {
                    throw new Error(validation.error);
                }
                
                this.log.debug(`Converting ${blob.type} → ${targetFormat}`, {
                    size: window.audioUtils.formatSize(blob.size),
                    options
                });
                
                // Get strategy
                const strategy = this.strategies.get(targetFormat.toLowerCase());
                if (!strategy) {
                    throw new Error(`No conversion strategy for format: ${targetFormat}`);
                }
                
                // Execute conversion with retry
                const converted = await window.errorHandling.retryWithBackoff(
                    () => strategy(blob, options),
                    {
                        maxRetries: 2,
                        initialDelay: 500,
                        operationName: `Convert to ${targetFormat}`
                    }
                );
                
                // Validate output
                const outputValidation = window.audioUtils.validateAudioBlob(converted);
                if (!outputValidation.valid) {
                    throw new Error(`Conversion output invalid: ${outputValidation.error}`);
                }
                
                this.log.debug('Conversion successful:', {
                    outputSize: window.audioUtils.formatSize(converted.size),
                    outputType: converted.type
                });
                
                return converted;
                
            },
            `Convert audio to ${targetFormat}`,
            { showError: false, throwError: true }
        );
    }
    
    /**
     * Convert audio to MP3 format
     * @param {Blob} blob - Source audio blob
     * @param {Object} options - Conversion options
     * @returns {Promise<Blob>} - MP3 audio blob
     */
    async convertToMP3(blob, options = {}) {
        // Check if already MP3
        if (blob.type === 'audio/mpeg' || blob.type === 'audio/mp3') {
            this.log.debug('Audio already in MP3 format');
            return blob;
        }
        
        // iOS Safari needs simple conversion
        if (window.audioUtils.isIOSSafari()) {
            this.log.debug('Using simple conversion for iOS Safari');
            return this.simpleConversion(blob, 'audio/mp3');
        }
        
        try {
            // Advanced conversion using Web Audio API
            return await this.advancedMP3Conversion(blob, options);
        } catch (error) {
            this.log.warn('Advanced MP3 conversion failed, using simple conversion:', error);
            // Fallback to simple conversion
            return this.simpleConversion(blob, 'audio/mp3');
        }
    }
    
    /**
     * Advanced MP3 conversion using Web Audio API
     * @param {Blob} blob - Source audio blob
     * @param {Object} options - Conversion options
     * @returns {Promise<Blob>} - MP3 audio blob
     */
    async advancedMP3Conversion(blob, options = {}) {
        const arrayBuffer = await blob.arrayBuffer();
        
        // Create audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        
        try {
            // Decode audio data
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Validate decoded buffer
            if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.duration === 0) {
                throw new Error('Decoded audio buffer is invalid');
            }
            
            this.log.debug('Audio decoded:', {
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate
            });
            
            // Create media stream from audio buffer
            const destination = audioContext.createMediaStreamDestination();
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(destination);
            
            // Start playback
            source.start(0);
            
            // Record as MP3 if supported
            const recorderOptions = {};
            if (MediaRecorder.isTypeSupported('audio/mpeg')) {
                recorderOptions.mimeType = 'audio/mpeg';
            } else if (MediaRecorder.isTypeSupported('audio/mp3')) {
                recorderOptions.mimeType = 'audio/mp3';
            }
            
            const recorder = new MediaRecorder(destination.stream, recorderOptions);
            const chunks = [];
            
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };
            
            // Start recording
            recorder.start();
            
            // Wait for buffer duration + margin
            await new Promise(resolve => {
                setTimeout(() => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                    resolve();
                }, (audioBuffer.duration * 1000) + 500);
            });
            
            // Wait for recorder to finish
            await new Promise(resolve => {
                recorder.onstop = resolve;
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            });
            
            // Create output blob
            const outputBlob = new Blob(chunks, { type: 'audio/mp3' });
            
            if (outputBlob.size === 0) {
                throw new Error('Conversion produced empty blob');
            }
            
            return outputBlob;
            
        } finally {
            // Cleanup audio context
            await audioContext.close();
        }
    }
    
    /**
     * Simple conversion by changing MIME type
     * @param {Blob} blob - Source audio blob
     * @param {string} mimeType - Target MIME type
     * @returns {Promise<Blob>} - Converted blob
     */
    async simpleConversion(blob, mimeType) {
        const arrayBuffer = await blob.arrayBuffer();
        return new Blob([arrayBuffer], { type: mimeType });
    }
    
    /**
     * Convert WebM audio to Opus format
     * @param {Blob} blob - Source WebM audio blob
     * @returns {Promise<Blob>} - Opus audio blob
     */
    async convertToOpus(blob) {
        // If already Opus-encoded, return as-is
        if (blob.type.includes('opus')) {
            return blob;
        }
        
        return new Promise((resolve, reject) => {
            try {
                // Create audio element
                const audio = new Audio();
                const url = URL.createObjectURL(blob);
                audio.src = url;
                
                // When metadata loads
                audio.onloadedmetadata = async () => {
                    try {
                        const duration = audio.duration;
                        if (!isFinite(duration) || duration <= 0) {
                            throw new Error('Invalid audio duration');
                        }
                        
                        // Create audio context
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        const context = new AudioContext();
                        
                        // Capture stream from audio element
                        const mediaStream = audio.captureStream ? audio.captureStream() : 
                                           audio.mozCaptureStream ? audio.mozCaptureStream() : null;
                        
                        if (!mediaStream) {
                            throw new Error('Browser does not support captureStream');
                        }
                        
                        // Create recorder with Opus format
                        const recOptions = {};
                        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                            recOptions.mimeType = 'audio/webm;codecs=opus';
                        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                            recOptions.mimeType = 'audio/ogg;codecs=opus';
                        }
                        
                        const recorder = new MediaRecorder(mediaStream, recOptions);
                        const chunks = [];
                        
                        recorder.ondataavailable = (e) => {
                            if (e.data.size > 0) {
                                chunks.push(e.data);
                            }
                        };
                        
                        recorder.onstop = () => {
                            URL.revokeObjectURL(url);
                            const opusBlob = new Blob(chunks, { 
                                type: recorder.mimeType || 'audio/ogg' 
                            });
                            resolve(opusBlob);
                        };
                        
                        // Start recording and playback
                        recorder.start();
                        audio.play();
                        
                        // Stop when playback ends
                        audio.onended = () => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                            }
                        };
                        
                        // Safety timeout
                        setTimeout(() => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                            }
                        }, (duration * 1000) + 2000);
                        
                    } catch (error) {
                        URL.revokeObjectURL(url);
                        reject(error);
                    }
                };
                
                audio.onerror = (error) => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Audio loading error: ${error.message || 'unknown'}`));
                };
                
                audio.load();
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Convert audio to WebM format
     * @param {Blob} blob - Source audio blob
     * @returns {Promise<Blob>} - WebM audio blob
     */
    async convertToWebM(blob) {
        // Simple conversion for now
        return this.simpleConversion(blob, 'audio/webm');
    }
    
    /**
     * Convert audio to WAV format
     * @param {Blob} blob - Source audio blob
     * @returns {Promise<Blob>} - WAV audio blob
     */
    async convertToWAV(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        
        // Create audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        
        try {
            // Decode audio
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Create WAV file from audio buffer
            // (Simplified - in production, use proper WAV encoding library)
            return new Blob([arrayBuffer], { type: 'audio/wav' });
            
        } finally {
            await audioContext.close();
        }
    }
    
    /**
     * Resize audio to maximum duration
     * @param {Blob} blob - Source audio blob
     * @param {number} maxDurationSeconds - Maximum duration in seconds
     * @returns {Promise<Blob>} - Resized audio blob
     */
    async resizeAudio(blob, maxDurationSeconds) {
        // TODO: Implement audio trimming
        this.log.warn('Audio resizing not yet implemented');
        return blob;
    }
}

// Export for use
window.AudioConversionService = AudioConversionService;
console.debug('[AudioConversionService] Service initialized');
