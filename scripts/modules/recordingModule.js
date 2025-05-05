/**
 * Manages audio recording functionality
 */
class RecordingModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
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
                    this.uiManager.showLoading('Starting recording...');
                    await audioRecorder.startRecording();
                    this.uiManager.hideLoading();
                    
                    // Update UI
                    startRecordingBtn.classList.add('hidden');
                    stopRecordingBtn.classList.remove('hidden');
                    stopRecordingBtn.classList.add('recording');
                } catch (error) {
                    this.uiManager.hideLoading();
                    console.error('Error starting recording:', error);
                    this.uiManager.showNotification(`Error starting recording: ${error.message}`, 'error');
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
                    this.uiManager.showLoading('Processing recording...');
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
                    
                    this.uiManager.hideLoading();
                } catch (error) {
                    this.uiManager.hideLoading();
                    console.error('Error stopping recording:', error);
                    this.uiManager.showNotification(`Error stopping recording: ${error.message}`, 'error');
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
                
                // Reset state
                if (audioRecorder.audioUrl) {
                    URL.revokeObjectURL(audioRecorder.audioUrl);
                    audioRecorder.audioUrl = null;
                    audioRecorder.audioBlob = null;
                }
                
                this.uiManager.showNotification('Recording discarded');
            });
        }
        
        // Transcribe audio button
        if (transcribeAudioBtn) {
            transcribeAudioBtn.addEventListener('click', async () => {
                console.log('Transcribe audio button clicked');
                if (!audioRecorder.audioBlob) {
                    this.uiManager.showNotification('No recording to transcribe', 'error');
                    return;
                }
                
                try {
                    this.uiManager.showLoading('Transcribing audio...');
                    
                    // Use the MP3 blob for transcription for better compatibility with Whisper API
                    const transcription = await apiHandler.transcribeAudio(audioRecorder.audioBlob);
                    
                    this.uiManager.hideLoading();
                    this.uiManager.showTranscriptionSection(transcription);
                } catch (error) {
                    this.uiManager.hideLoading();
                    console.error('Error transcribing audio:', error);
                    this.uiManager.showNotification(`Error transcribing audio: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Recording events set up');
    }
}
