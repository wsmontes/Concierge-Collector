/**
 * Recording UI Manager - Centralized UI state management for audio recording
 * 
 * Purpose: Manages all UI updates related to recording (buttons, timer, visualizer, status)
 * 
 * Main Responsibilities:
 * - Button state management (enable/disable/show/hide)
 * - Recording timer (start/stop/update)
 * - Audio visualizer (setup/render/stop)
 * - Status indicators and progress
 * - Audio preview display
 * 
 * Dependencies: uiHelpers
 */

class RecordingUIManager {
    constructor() {
        this.log = Logger.module('RecordingUIManager');
        
        // Timer state
        this.timerInterval = null;
        this.timerStartTime = null;
        
        // Visualizer state
        this.visualizerFrame = null;
        this.audioContext = null;
        this.analyser = null;
        
        // Validate dependencies
        if (!window.uiHelpers) {
            throw new Error('uiHelpers not loaded');
        }
    }
    
    /**
     * Update recording button states
     * @param {boolean} isRecording - Whether recording is active
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    updateButtonStates(isRecording, isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        
        const startBtn = document.getElementById(`${prefix}start-record`);
        const stopBtn = document.getElementById(`${prefix}stop-record`);
        const recordingTime = document.getElementById(`${prefix}recording-time`);
        const visualizer = document.getElementById(`${prefix}audio-visualizer`);
        
        if (isRecording) {
            if (startBtn) startBtn.classList.add('hidden');
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (recordingTime) recordingTime.classList.remove('hidden');
            if (visualizer) visualizer.classList.remove('hidden');
        } else {
            if (startBtn) startBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (recordingTime) recordingTime.classList.add('hidden');
            if (visualizer) visualizer.classList.add('hidden');
        }
    }
    
    /**
     * Start recording timer
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    startTimer(isAdditional = false) {
        this.stopTimer(); // Clear any existing timer
        
        const prefix = isAdditional ? 'additional-' : '';
        const timerElements = [
            document.getElementById(`${prefix}recording-time`),
            document.getElementById('timer')
        ].filter(el => el);
        
        if (timerElements.length === 0) return;
        
        this.timerStartTime = Date.now();
        
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
            const formattedTime = window.uiHelpers.formatDuration ? 
                window.uiHelpers.formatDuration(elapsed) : 
                this.formatTime(elapsed);
            
            timerElements.forEach(timer => {
                timer.textContent = formattedTime;
                timer.classList.remove('hidden');
                
                // Add warning state at 4+ minutes
                if (elapsed >= 240) {
                    timer.classList.add('text-red-600', 'font-bold');
                } else {
                    timer.classList.remove('text-red-600', 'font-bold');
                }
            });
        }, 1000);
    }
    
    /**
     * Stop recording timer
     */
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        // Reset timer displays
        ['recording-time', 'additional-recording-time', 'timer'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '00:00';
                element.classList.add('hidden');
                element.classList.remove('text-red-600', 'font-bold');
            }
        });
    }
    
    /**
     * Format time in MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} - Formatted time
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Setup audio visualizer
     * @param {MediaStream} stream - Audio media stream
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    setupVisualizer(stream, isAdditional = false) {
        try {
            const canvasId = isAdditional ? 'additional-visualizer-canvas' : 'audio-visualizer-canvas';
            const canvas = document.getElementById(canvasId);
            
            if (!canvas) {
                this.log.debug('Visualizer canvas not found');
                return;
            }
            
            // Create audio context
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Connect stream to analyser
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            
            // Setup canvas
            const canvasCtx = canvas.getContext('2d');
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
            
            // Animation loop
            const draw = () => {
                this.visualizerFrame = requestAnimationFrame(draw);
                
                this.analyser.getByteFrequencyData(dataArray);
                
                canvasCtx.fillStyle = isAdditional ? '#f3e8ff' : '#000000';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                
                const barWidth = (canvas.width / bufferLength) * 2.5;
                let x = 0;
                
                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = dataArray[i] / 3;
                    
                    canvasCtx.fillStyle = isAdditional ? 
                        `rgb(147, ${105 + i}, 234)` : 
                        `rgb(${50 + i}, ${50 + i}, 255)`;
                    
                    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                    x += barWidth + 1;
                }
            };
            
            draw();
            
        } catch (error) {
            this.log.error('Error setting up visualizer:', error);
        }
    }
    
    /**
     * Stop audio visualizer
     */
    stopVisualizer() {
        if (this.visualizerFrame) {
            cancelAnimationFrame(this.visualizerFrame);
            this.visualizerFrame = null;
        }
        
        // Hide visualizer elements
        ['audio-visualizer', 'additional-audio-visualizer'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.add('hidden');
        });
    }
    
    /**
     * Show recording status
     * @param {string} message - Status message
     * @param {string} type - Status type (recording, processing, error, success)
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    showStatus(message, type = 'recording', isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        const statusId = `${prefix}recording-status`;
        const statusElement = document.getElementById(statusId);
        
        if (!statusElement) return;
        
        const icons = {
            recording: 'fiber_manual_record',
            processing: 'hourglass_top',
            error: 'error',
            success: 'check_circle'
        };
        
        const colors = {
            recording: isAdditional ? 'text-purple-700' : 'text-red-700',
            processing: 'text-blue-700',
            error: 'text-red-700',
            success: 'text-green-700'
        };
        
        statusElement.innerHTML = `
            <div class="flex items-center ${colors[type]}">
                <span class="material-icons mr-1">${icons[type]}</span>
                <span>${message}</span>
            </div>
        `;
    }
    
    /**
     * Clear recording status
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    clearStatus(isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        const statusElement = document.getElementById(`${prefix}recording-status`);
        if (statusElement) statusElement.innerHTML = '';
    }
    
    /**
     * Show processing progress
     * @param {string} message - Progress message
     * @param {number} percent - Progress percentage (0-100)
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    showProgress(message, percent = 0, isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        const progressId = `${prefix}transcription-status`;
        const progressElement = document.getElementById(progressId);
        
        if (!progressElement) return;
        
        progressElement.classList.remove('hidden');
        progressElement.innerHTML = `
            <div class="flex items-center text-blue-700">
                <div class="mr-2 h-4 w-4 rounded-full bg-blue-400 animate-pulse"></div>
                <span>${message}</span>
                ${percent > 0 ? `<span class="ml-2 text-sm">(${percent}%)</span>` : ''}
            </div>
        `;
    }
    
    /**
     * Hide processing progress
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    hideProgress(isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        ['transcription-status', 'analysis-status'].forEach(id => {
            const element = document.getElementById(`${prefix}${id}`);
            if (element) element.classList.add('hidden');
        });
    }
    
    /**
     * Show audio preview
     * @param {Blob} audioBlob - Audio blob to preview
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    showAudioPreview(audioBlob, isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        const previewId = `${prefix}audio-preview`;
        const audioId = `${prefix}recorded-audio`;
        
        const previewContainer = document.getElementById(previewId);
        const audioElement = document.getElementById(audioId);
        
        if (!previewContainer) return;
        
        previewContainer.classList.remove('hidden');
        
        if (audioElement) {
            const audioUrl = URL.createObjectURL(audioBlob);
            audioElement.src = audioUrl;
        }
    }
    
    /**
     * Hide audio preview
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    hideAudioPreview(isAdditional = false) {
        const prefix = isAdditional ? 'additional-' : '';
        const previewContainer = document.getElementById(`${prefix}audio-preview`);
        
        if (previewContainer) {
            previewContainer.classList.add('hidden');
        }
    }
    
    /**
     * Show error message
     * @param {string} message - Error message
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    showError(message, isAdditional = false) {
        this.showStatus(message, 'error', isAdditional);
        window.uiHelpers.showNotification(message, 'error');
    }
    
    /**
     * Show success message
     * @param {string} message - Success message
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    showSuccess(message, isAdditional = false) {
        this.showStatus(message, 'success', isAdditional);
        window.uiHelpers.showNotification(message, 'success');
    }
    
    /**
     * Reset all UI elements
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    reset(isAdditional = false) {
        this.updateButtonStates(false, isAdditional);
        this.stopTimer();
        this.stopVisualizer();
        this.clearStatus(isAdditional);
        this.hideProgress(isAdditional);
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopTimer();
        this.stopVisualizer();
        
        if (this.audioContext) {
            try {
                this.audioContext.close();
                this.audioContext = null;
            } catch (error) {
                this.log.error('Error closing audio context:', error);
            }
        }
    }
}

window.RecordingUIManager = RecordingUIManager;
console.debug('[RecordingUIManager] Service initialized');
