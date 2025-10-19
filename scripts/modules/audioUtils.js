/**
 * Audio utility functions for format conversion and processing
 * Provides robust conversion methods for various browsers and platforms
 */

const AudioUtils = {
    // Create module logger instance
    _log: Logger.module('AudioUtils'),
    
    /**
     * Convert any audio format to MP3 for better compatibility with APIs
     * @param {Blob} audioBlob - Input audio blob in any format
     * @returns {Promise<Blob>} MP3 audio blob or best compatible format
     */
    convertToMP3: async function(audioBlob) {
        try {
            AudioUtils._log.debug('AudioUtils: Converting audio to MP3, original type:', audioBlob.type);
            
            // If already MP3, return as is
            if (audioBlob.type === 'audio/mpeg' || audioBlob.type === 'audio/mp3') {
                return audioBlob;
            }
            
            // For iOS, use the simplified approach
            if (this.isIOSSafari()) {
                return await this.iosAudioConversion(audioBlob);
            }
            
            // Try the Web Audio API approach first
            try {
                const mp3Blob = await this.webAudioConversion(audioBlob);
                if (mp3Blob && mp3Blob.size > 0) {
                    AudioUtils._log.debug('AudioUtils: Web Audio conversion successful, size:', mp3Blob.size);
                    return mp3Blob;
                }
            } catch (webAudioError) {
                AudioUtils._log.warn('AudioUtils: Web Audio conversion failed:', webAudioError);
            }
            
            // Try the MediaStream approach as fallback
            try {
                const mediaBlob = await this.mediaStreamConversion(audioBlob);
                if (mediaBlob && mediaBlob.size > 0) {
                    AudioUtils._log.debug('AudioUtils: MediaStream conversion successful, size:', mediaBlob.size);
                    return mediaBlob;
                }
            } catch (mediaError) {
                AudioUtils._log.warn('AudioUtils: MediaStream conversion failed:', mediaError);
            }
            
            // Last resort: just repackage with MP3 MIME type
            AudioUtils._log.debug('AudioUtils: Using MIME type repackaging as last resort');
            return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
            
        } catch (error) {
            AudioUtils._log.error('AudioUtils: Error in convertToMP3:', error);
            // In case of any error, return the original blob with MP3 MIME type
            return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
        }
    },
    
    /**
     * Detects if running on iOS Safari
     * @returns {boolean} True if iOS Safari
     */
    isIOSSafari: function() {
        const ua = navigator.userAgent;
        return /iPad|iPhone|iPod/.test(ua) && !window.MSStream && /Safari/.test(ua);
    },
    
    /**
     * Convert audio using Web Audio API
     * @param {Blob} audioBlob - Input audio blob
     * @returns {Promise<Blob>} Converted audio blob
     */
    webAudioConversion: async function(audioBlob) {
        return new Promise(async (resolve, reject) => {
            try {
                const fileReader = new FileReader();
                
                fileReader.onload = async (event) => {
                    try {
                        const arrayBuffer = event.target.result;
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        const audioContext = new AudioContext();
                        
                        // Decode the audio
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        
                        // Convert to WAV format (widely supported)
                        const wavBlob = await this.audioBufferToWav(audioBuffer);
                        
                        // Set the MIME type to MP3 for API compatibility
                        const outputBlob = new Blob([wavBlob], { type: 'audio/mp3' });
                        resolve(outputBlob);
                        
                    } catch (err) {
                        reject(err);
                    }
                };
                
                fileReader.onerror = reject;
                fileReader.readAsArrayBuffer(audioBlob);
                
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Convert AudioBuffer to WAV format
     * @param {AudioBuffer} audioBuffer - Web Audio API buffer
     * @returns {Blob} WAV blob
     */
    audioBufferToWav: function(audioBuffer) {
        // Get buffer data
        const numOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length * numOfChannels * 2; // 2 bytes per sample
        const sampleRate = audioBuffer.sampleRate;
        
        // Create buffer with WAV header space
        const buffer = new ArrayBuffer(44 + length);
        const view = new DataView(buffer);
        
        // Write WAV header
        this.writeWavHeader(view, numOfChannels, sampleRate, 16, length);
        
        // Write audio data
        this.writeAudioData(view, audioBuffer, numOfChannels);
        
        return new Blob([buffer], { type: 'audio/wav' });
    },
    
    /**
     * Write WAV header to DataView
     * @param {DataView} view - DataView to write to
     * @param {number} numChannels - Number of audio channels
     * @param {number} sampleRate - Audio sample rate
     * @param {number} bitsPerSample - Bits per sample
     * @param {number} dataLength - Length of audio data in bytes
     */
    writeWavHeader: function(view, numChannels, sampleRate, bitsPerSample, dataLength) {
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        // RIFF identifier
        writeString(view, 0, 'RIFF');
        // File length minus RIFF identifier and chunk size
        view.setUint32(4, 36 + dataLength, true);
        // RIFF type
        writeString(view, 8, 'WAVE');
        // Format chunk identifier
        writeString(view, 12, 'fmt ');
        // Format chunk length
        view.setUint32(16, 16, true);
        // Sample format (raw)
        view.setUint16(20, 1, true);
        // Channel count
        view.setUint16(22, numChannels, true);
        // Sample rate
        view.setUint32(24, sampleRate, true);
        // Byte rate (sample rate * block align)
        view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
        // Block align (channel count * bytes per sample)
        view.setUint16(32, numChannels * (bitsPerSample / 8), true);
        // Bits per sample
        view.setUint16(34, bitsPerSample, true);
        // Data chunk identifier
        writeString(view, 36, 'data');
        // Data chunk length
        view.setUint32(40, dataLength, true);
    },
    
    /**
     * Write audio data to DataView
     * @param {DataView} view - DataView to write to
     * @param {AudioBuffer} audioBuffer - Audio data
     * @param {number} numChannels - Number of audio channels
     */
    writeAudioData: function(view, audioBuffer, numChannels) {
        const length = audioBuffer.length;
        const channels = [];
        
        // Extract channel data
        for (let c = 0; c < numChannels; c++) {
            channels.push(audioBuffer.getChannelData(c));
        }
        
        // Interleave channel data and convert to 16-bit PCM
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let c = 0; c < numChannels; c++) {
                const sample = Math.max(-1, Math.min(1, channels[c][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }
    },
    
    /**
     * Convert audio using MediaStream API - useful for browsers that don't support WebAudio well
     * @param {Blob} audioBlob - Input audio blob
     * @returns {Promise<Blob>} Converted audio blob
     */
    mediaStreamConversion: async function(audioBlob) {
        return new Promise((resolve, reject) => {
            try {
                const audio = new Audio();
                const audioUrl = URL.createObjectURL(audioBlob);
                
                audio.addEventListener('loadedmetadata', () => {
                    try {
                        // Check if this browser supports captureStream
                        if (!audio.captureStream && !audio.mozCaptureStream) {
                            throw new Error('Browser does not support audio capture stream');
                        }
                        
                        // Get the stream
                        const stream = audio.captureStream ? audio.captureStream() : audio.mozCaptureStream();
                        
                        // Create MediaRecorder
                        const options = {};
                        if (MediaRecorder.isTypeSupported('audio/mp3')) {
                            options.mimeType = 'audio/mp3';
                        } else if (MediaRecorder.isTypeSupported('audio/mpeg')) {
                            options.mimeType = 'audio/mpeg';
                        } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                            options.mimeType = 'audio/webm;codecs=opus';
                        }
                        
                        const recorder = new MediaRecorder(stream, options);
                        const chunks = [];
                        
                        recorder.addEventListener('dataavailable', e => {
                            if (e.data.size > 0) chunks.push(e.data);
                        });
                        
                        recorder.addEventListener('stop', () => {
                            URL.revokeObjectURL(audioUrl);
                            const mimeType = recorder.mimeType || 'audio/mpeg';
                            const resultBlob = new Blob(chunks, { type: mimeType });
                            resolve(resultBlob);
                        });
                        
                        // Start recording
                        recorder.start();
                        audio.play();
                        
                        // Stop when audio ends
                        audio.addEventListener('ended', () => {
                            if (recorder.state === 'recording') recorder.stop();
                        });
                        
                        // Set a timeout as fallback
                        const duration = audio.duration;
                        if (isFinite(duration) && duration > 0) {
                            setTimeout(() => {
                                if (recorder.state === 'recording') recorder.stop();
                            }, (duration * 1000) + 500);
                        } else {
                            setTimeout(() => {
                                if (recorder.state === 'recording') recorder.stop();
                            }, 10000); // 10 second fallback
                        }
                        
                    } catch (error) {
                        URL.revokeObjectURL(audioUrl);
                        reject(error);
                    }
                });
                
                audio.addEventListener('error', error => {
                    URL.revokeObjectURL(audioUrl);
                    reject(new Error(`Audio load error: ${error.message || 'Unknown error'}`));
                });
                
                audio.src = audioUrl;
                audio.load();
                
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Special audio conversion for iOS Safari
     * @param {Blob} audioBlob - Input audio blob
     * @returns {Promise<Blob>} Converted audio blob
     */
    iosAudioConversion: async function(audioBlob) {
        // For iOS, we simply repackage with MP3 MIME type
        // This is because iOS Safari doesn't support the advanced Web Audio features
        return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
    }
};

// Make AudioUtils globally available
window.AudioUtils = AudioUtils;
