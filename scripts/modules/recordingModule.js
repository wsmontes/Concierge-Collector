/**
 * Manages audio recording functionality
 */
class RecordingModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                console.log('RecordingModule: Using window.uiUtils.showLoading()');
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                console.log('RecordingModule: Using this.uiManager.showLoading()');
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('RecordingModule: Using alert as fallback for loading');
            alert(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            // Last resort
            alert(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     */
    safeHideLoading() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                console.log('RecordingModule: Using window.uiUtils.hideLoading()');
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                console.log('RecordingModule: Using this.uiManager.hideLoading()');
                this.uiManager.hideLoading();
                return;
            }
            
            // Last resort - just log since there's no visual to clear
            console.log('RecordingModule: Hiding loading indicator (fallback)');
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
        }
    }
    
    /**
     * Safety wrapper for showing notification - uses global uiUtils as primary fallback
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     */
    safeShowNotification(message, type = 'success') {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                console.log('RecordingModule: Using window.uiUtils.showNotification()');
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                console.log('RecordingModule: Using this.uiManager.showNotification()');
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`RecordingModule: Notification (${type}):`, message);
            if (type === 'error') {
                alert(`Error: ${message}`);
            } else {
                alert(message);
            }
        } catch (error) {
            console.error('Error in safeShowNotification:', error);
            // Last resort
            alert(message);
        }
    }

    setupEvents() {
        console.log('Setting up recording events...');
        
        // Start recording button
        const startRecordingBtn = document.getElementById('start-recording');
        const stopRecordingBtn = document.getElementById('stop-recording');
        const discardRecordingBtn = document.getElementById('discard-recording');
        const transcribeAudioBtn = document.getElementById('transcribe-audio');
        
        if (startRecordingBtn) {
            startRecordingBtn.addEventListener('click', async () => {
                console.log('Start recording button clicked');
                try {
                    this.safeShowLoading('Starting recording...');
                    await audioRecorder.startRecording();
                    this.safeHideLoading();
                    
                    // Update UI
                    startRecordingBtn.classList.add('hidden');
                    stopRecordingBtn.classList.remove('hidden');
                    stopRecordingBtn.classList.add('recording');
                } catch (error) {
                    this.safeHideLoading();
                    console.error('Error starting recording:', error);
                    this.safeShowNotification(`Error starting recording: ${error.message}`, 'error');
                }
            });
        } else {
            console.warn('Start recording button not found in DOM');
        }
        
        // Stop recording button
        if (stopRecordingBtn) {
            stopRecordingBtn.addEventListener('click', async () => {
                console.log('Stop recording button clicked');
                try {
                    this.safeShowLoading('Processing recording...');
                    const audioData = await audioRecorder.stopRecording();
                    
                    // Get the recording
                    const audioPreview = document.getElementById('audio-preview');
                    const audioElement = document.getElementById('recorded-audio');
                    
                    // Use MP3 URL for better browser compatibility
                    audioElement.src = audioData.mp3Url || audioData.webmUrl;
                    audioPreview.classList.remove('hidden');
                    
                    // Update UI
                    startRecordingBtn.classList.remove('hidden');
                    stopRecordingBtn.classList.add('hidden');
                    stopRecordingBtn.classList.remove('recording');
                    
                    // Show status for automatic processing
                    const transcriptionStatus = document.getElementById('transcription-status');
                    if (transcriptionStatus) {
                        this.uiManager.updateProcessingStatus('transcription', 'in-progress', 'Transcribing audio...');
                    }
                    
                    try {
                        // Automatically start transcription
                        this.safeShowLoading('Transcribing audio...');
                        const transcription = await apiHandler.transcribeAudio(audioRecorder.audioBlob);
                        
                        // Update UI to show transcription
                        this.uiManager.showTranscriptionSection(transcription);
                        
                        // Automatically start concept extraction
                        try {
                            await this.uiManager.conceptModule.processConcepts(transcription);
                        } catch (conceptError) {
                            console.error('Error extracting concepts:', conceptError);
                            this.safeShowNotification(`Error analyzing restaurant details: ${conceptError.message}`, 'error');
                        }
                        
                        this.safeHideLoading();
                    } catch (processError) {
                        this.safeHideLoading();
                        console.error('Error in automatic processing:', processError);
                        this.safeShowNotification(`Processing error: ${processError.message}. You can try manual transcription.`, 'error');
                        
                        // Show manual transcribe button as fallback
                        const transcribeAudioBtn = document.getElementById('transcribe-audio');
                        if (transcribeAudioBtn) {
                            transcribeAudioBtn.classList.remove('hidden');
                        }
                    }
                } catch (error) {
                    this.safeHideLoading();
                    console.error('Error stopping recording:', error);
                    this.safeShowNotification(`Error stopping recording: ${error.message}`, 'error');
                }
            });
        } else {
            console.warn('Stop recording button not found in DOM');
        }
        
        // Discard recording button
        if (discardRecordingBtn) {
            discardRecordingBtn.addEventListener('click', () => {
                console.log('Discard recording button clicked');
                const audioPreview = document.getElementById('audio-preview');
                const audioElement = document.getElementById('recorded-audio');
                
                // Clear audio element and hide preview
                audioElement.src = '';
                audioPreview.classList.add('hidden');
                
                // Reset processing status indicators
                this.uiManager.updateProcessingStatus('transcription', 'pending', 'Transcribing your audio...');
                this.uiManager.updateProcessingStatus('analysis', 'pending', 'Analyzing restaurant details...');
                
                // Reset state
                if (audioRecorder.audioUrl) {
                    URL.revokeObjectURL(audioRecorder.audioUrl);
                    audioRecorder.audioUrl = null;
                    audioRecorder.audioBlob = null;
                }
                
                // Hide manual transcribe button
                const transcribeAudioBtn = document.getElementById('transcribe-audio');
                if (transcribeAudioBtn) {
                    transcribeAudioBtn.classList.add('hidden');
                }
                
                this.safeShowNotification('Recording discarded');
            });
        }
        
        // Transcribe audio button
        if (transcribeAudioBtn) {
            transcribeAudioBtn.addEventListener('click', async () => {
                console.log('Transcribe audio button clicked');
                if (!audioRecorder.audioBlob) {
                    this.safeShowNotification('No recording to transcribe', 'error');
                    return;
                }
                
                try {
                    this.safeShowLoading('Transcribing audio...');
                    
                    // Use the MP3 blob for transcription for better compatibility with Whisper API
                    const transcription = await apiHandler.transcribeAudio(audioRecorder.audioBlob);
                    
                    this.safeHideLoading();
                    this.uiManager.showTranscriptionSection(transcription);
                } catch (error) {
                    this.safeHideLoading();
                    console.error('Error transcribing audio:', error);
                    this.safeShowNotification(`Error transcribing audio: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Recording events set up');
    }
    
    /**
     * Recording Module enhancements
     */

    /**
     * Modify the startRecording method to handle additional recording mode
     */
    startRecording() {
        console.log('Starting recording, additional mode:', this.uiManager?.isRecordingAdditional || false);
        
        // Check if we're in additional recording mode
        const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
        
        try {
            // Update UI to indicate recording mode
            if (isAdditional) {
                const recordingStatus = document.getElementById('recording-status');
                if (recordingStatus) {
                    recordingStatus.innerHTML = `
                        <div class="flex items-center">
                            <span class="recording-indicator"></span>
                            <span>Recording Additional Review...</span>
                        </div>
                    `;
                    console.log('UI updated for additional recording mode');
                } else {
                    console.warn('Recording status element not found');
                }
            }
            
            // Call the original method
            return originalStartRecording.call(this);
        } catch (error) {
            console.error('Error starting recording:', error);
            throw error;
        }
    }

    /**
     * Modify stopRecording to handle additional recordings
     */
    stopRecording() {
        console.log('Stopping recording, additional mode:', this.uiManager?.isRecordingAdditional || false);
        
        // Check if we're in additional recording mode
        const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
        
        // If in additional mode, update the status message
        if (isAdditional) {
            const recordingStatus = document.getElementById('recording-status');
            if (recordingStatus) {
                recordingStatus.innerHTML = `
                    <div class="flex items-center">
                        <span class="material-icons text-green-500 mr-1">check_circle</span>
                        <span>Processing Additional Review...</span>
                    </div>
                `;
            }
        }
        
        // Call the original method
        return originalStopRecording.call(this);
    }

    /**
     * Process the completed transcription
     * @param {string} transcription - The transcribed text
     */
    processTranscription(transcription) {
        console.log('Processing transcription, additional mode:', this.uiManager?.isRecordingAdditional || false);
        
        // Make sure we're passing through the additional recording flag context
        if (this.uiManager && this.uiManager.handleTranscriptionComplete) {
            this.uiManager.handleTranscriptionComplete(transcription);
        }
        
        // ...existing code...
    }
}

/**
 * Recording Module - Handles audio recording and transcription
 * Dependencies: Whisper API, uiManager
 */

/**
 * Start recording audio
 * @returns {Promise<void>}
 */
const originalStartRecording = this.startRecording;
this.startRecording = async function() {
    const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
    console.log(`Starting recording, additional mode: ${isAdditional}`);
    
    // Update UI feedback for additional recording mode
    if (isAdditional) {
        const recordingStatus = document.getElementById('recording-status');
        if (recordingStatus) {
            recordingStatus.innerHTML = `
                <div class="flex items-center text-purple-700">
                    <span class="recording-indicator additional-recording"></span>
                    <span>Recording Additional Review...</span>
                </div>
            `;
        }
        
        // Add additional recording class to body for global styling
        document.body.classList.add('additional-recording-active');
    }
    
    // Call the original method
    return originalStartRecording.call(this);
};

/**
 * Stop recording audio
 * @returns {Promise<void>}
 */
const originalStopRecording = this.stopRecording;
this.stopRecording = async function() {
    const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
    console.log(`Stopping recording, additional mode: ${isAdditional}`);
    
    // Update UI feedback for additional recording mode
    if (isAdditional) {
        const recordingStatus = document.getElementById('recording-status');
        if (recordingStatus) {
            recordingStatus.innerHTML = `
                <div class="flex items-center text-purple-700">
                    <span class="material-icons text-purple-500 mr-1">hourglass_top</span>
                    <span>Processing Additional Review...</span>
                </div>
            `;
        }
    }
    
    try {
        // Call the original method
        return await originalStopRecording.call(this);
    } finally {
        // Always clean up the additional recording class
        if (isAdditional) {
            document.body.classList.remove('additional-recording-active');
        }
    }
};

/**
 * Process transcription results
 * @param {string} transcription - The transcribed text
 */
const originalProcessTranscription = this.processTranscription;
this.processTranscription = function(transcription) {
    const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
    console.log(`Processing transcription, length: ${transcription.length}, additional mode: ${isAdditional}`);
    
    // Call the original method
    originalProcessTranscription.call(this, transcription);
    
    // For additional recording mode, update UI
    if (isAdditional) {
        const recordingStatus = document.getElementById('recording-status');
        if (recordingStatus) {
            recordingStatus.innerHTML = `
                <div class="flex items-center text-green-700">
                    <span class="material-icons text-green-500 mr-1">check_circle</span>
                    <span>Additional Review Added</span>
                </div>
            `;
            
            // Auto-hide the status after 3 seconds
            setTimeout(() => {
                if (recordingStatus.parentNode) {
                    recordingStatus.innerHTML = '';
                }
            }, 3000);
        }
    }
};
