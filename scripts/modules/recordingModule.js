/**
 * Recording Module - Handles audio recording and transcription
 * Dependencies: Whisper API, uiManager
 */
class RecordingModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.audioChunks = [];
        this.visualizationFrame = null;
        this.audioContext = null;
        this.analyser = null;
        this.recordingTimer = null;
        this.recordingStartTime = null;
    }

    /**
     * Setup event listeners for recording functionality
     * Called by UIManager during initialization
     */
    setupEvents() {
        console.log('Setting up recording events...');
        
        // Start recording button
        const startRecordBtn = document.getElementById('start-record');
        if (startRecordBtn) {
            startRecordBtn.addEventListener('click', async () => {
                try {
                    await this.startRecording();
                } catch (error) {
                    console.error('Error starting recording:', error);
                    if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                        this.uiManager.showNotification('Error starting recording: ' + error.message, 'error');
                    }
                }
            });
        }
        
        // Stop recording button
        const stopRecordBtn = document.getElementById('stop-record');
        if (stopRecordBtn) {
            stopRecordBtn.addEventListener('click', async () => {
                try {
                    await this.stopRecording();
                } catch (error) {
                    console.error('Error stopping recording:', error);
                    if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                        this.uiManager.showNotification('Error stopping recording: ' + error.message, 'error');
                    }
                }
            });
        }
        
        console.log('Recording events set up successfully');
    }

    /**
     * Starts recording audio with support for both regular and additional recording modes
     */
    async startRecording() {
        try {
            // Determine if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            console.log(`Starting recording, additional mode: ${isAdditional}`);
            
            // Update UI for additional recording mode
            if (isAdditional) {
                const startBtn = document.getElementById('additional-record-start');
                const stopBtn = document.getElementById('additional-record-stop');
                const recordingTime = document.getElementById('additional-recording-time');
                const audioVisualizer = document.getElementById('additional-audio-visualizer');
                const recordingStatus = document.getElementById('additional-recording-status');
                
                if (startBtn) startBtn.classList.add('hidden');
                if (stopBtn) stopBtn.classList.remove('hidden');
                if (recordingTime) recordingTime.classList.remove('hidden');
                if (audioVisualizer) audioVisualizer.classList.remove('hidden');
                if (recordingStatus) recordingStatus.textContent = 'Recording in progress...';
                
                // Start the timer
                if (typeof this.startRecordingTimer === 'function') {
                    this.startRecordingTimer(recordingTime);
                }
            }
            
            // Basic browser support check
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Audio recording not supported in this browser');
            }
            
            // Request audio stream
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaStream = stream;
            
            // Create media recorder
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            // Set up event handlers
            this.mediaRecorder.addEventListener('dataavailable', e => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            });
            
            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;
            
            // Update recording status
            const recordingStatus = document.getElementById('recording-status');
            if (recordingStatus) {
                recordingStatus.innerHTML = `
                    <div class="flex items-center ${isAdditional ? 'text-purple-700' : 'text-red-700'}">
                        <span class="recording-indicator ${isAdditional ? 'additional-recording' : ''}"></span>
                        <span>${isAdditional ? 'Recording Additional Review...' : 'Recording...'}</span>
                    </div>
                `;
            } else {
                console.log('Recording status element not found');
            }
            
            // Initialize the audio context for visualization
            if (typeof this.setupVisualization === 'function') {
                this.setupVisualization(isAdditional);
            }
        } catch (error) {
            console.log('Error starting recording:', error);
            throw error;
        }
    }

    /**
     * Stops recording audio
     */
    async stopRecording() {
        try {
            // Check if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            console.log(`Stopping recording, additional mode: ${isAdditional}`);
            
            // Update UI for additional recording mode
            if (isAdditional) {
                const startBtn = document.getElementById('additional-record-start');
                const stopBtn = document.getElementById('additional-record-stop');
                const recordingTime = document.getElementById('additional-recording-time');
                const audioVisualizer = document.getElementById('additional-audio-visualizer');
                const recordingStatus = document.getElementById('additional-recording-status');
                
                if (startBtn) startBtn.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
                if (recordingTime) recordingTime.classList.add('hidden');
                if (audioVisualizer) audioVisualizer.classList.add('hidden');
                if (recordingStatus) recordingStatus.textContent = 'Transcribing...';
                
                // Stop the timer
                if (typeof this.stopRecordingTimer === 'function') {
                    this.stopRecordingTimer();
                }
                
                // Show transcription status
                const transcriptionStatus = document.getElementById('additional-transcription-status');
                if (transcriptionStatus) {
                    transcriptionStatus.classList.remove('hidden');
                }
            }
            
            // Can't stop if not recording
            if (!this.isRecording || !this.mediaRecorder) {
                console.log('No active recording to stop');
                return;
            }
            
            // Only stop if active
            if (this.mediaRecorder.state === 'inactive') {
                console.log('Media recorder already inactive');
                return;
            }
            
            return new Promise(resolve => {
                this.mediaRecorder.addEventListener('stop', async () => {
                    try {
                        // Get recording and clean up
                        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                        
                        // Stop all tracks in the media stream
                        if (this.mediaStream) {
                            this.mediaStream.getTracks().forEach(track => track.stop());
                        }
                        
                        // Update recording status
                        const recordingStatus = document.getElementById('recording-status');
                        if (recordingStatus) {
                            recordingStatus.innerHTML = `
                                <div class="flex items-center ${isAdditional ? 'text-purple-700' : 'text-blue-700'}">
                                    <span class="material-icons text-${isAdditional ? 'purple' : 'blue'}-500 mr-1">hourglass_top</span>
                                    <span>${isAdditional ? 'Processing Additional Review...' : 'Processing recording...'}</span>
                                </div>
                            `;
                        }
                        
                        // Stop visualization
                        if (typeof this.stopVisualization === 'function') {
                            this.stopVisualization();
                        }
                        
                        // Process the recording
                        await this.processRecording(audioBlob);
                        
                        // Hide transcription status if in additional mode
                        if (isAdditional) {
                            const transcriptionStatus = document.getElementById('additional-transcription-status');
                            if (transcriptionStatus) {
                                transcriptionStatus.classList.add('hidden');
                            }
                        }
                        
                        resolve();
                    } catch (error) {
                        console.error('Error in stop recording handler:', error);
                        
                        // Hide transcription status if in additional mode
                        if (isAdditional) {
                            const transcriptionStatus = document.getElementById('additional-transcription-status');
                            if (transcriptionStatus) {
                                transcriptionStatus.classList.add('hidden');
                            }
                        }
                        
                        throw error;
                    }
                });
                
                this.mediaRecorder.stop();
                this.isRecording = false;
            });
        } catch (error) {
            console.error('Error stopping recording:', error);
            throw error;
        }
    }

    /**
     * Start a timer for recording duration
     * @param {HTMLElement} timerElement - Element to show timer in
     */
    startRecordingTimer(timerElement) {
        if (!timerElement) return;
        
        this.recordingStartTime = Date.now();
        this.recordingTimer = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
            const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
            timerElement.textContent = `${minutes}:${seconds}`;
        }, 1000);
    }

    /**
     * Stop the recording timer
     */
    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }

    /**
     * Setup audio visualization
     * @param {boolean} isAdditional - Whether this is an additional recording
     */
    setupVisualization(isAdditional) {
        try {
            // Get the appropriate canvas based on recording mode
            const canvasId = isAdditional ? 'additional-visualizer-canvas' : 'audio-visualizer-canvas';
            const visualizerContainer = document.getElementById(isAdditional ? 'additional-audio-visualizer' : 'audio-visualizer');
            const canvas = document.getElementById(canvasId);
            
            if (!canvas || !visualizerContainer) return;
            
            // Show the visualizer container
            visualizerContainer.classList.remove('hidden');
            
            // Create audio context and analyzer if they don't exist
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Create analyzer node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Connect media stream to analyzer
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            
            // Get canvas context
            const canvasCtx = canvas.getContext('2d');
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // Set canvas dimensions
            canvas.width = visualizerContainer.clientWidth;
            canvas.height = visualizerContainer.clientHeight;
            
            // Animation function
            const draw = () => {
                if (!this.isRecording) return;
                
                this.visualizationFrame = requestAnimationFrame(draw);
                
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
            console.error('Error setting up visualization:', error);
        }
    }

    /**
     * Stop audio visualization
     */
    stopVisualization() {
        if (this.visualizationFrame) {
            cancelAnimationFrame(this.visualizationFrame);
            this.visualizationFrame = null;
        }
    }
    
    /**
     * Convert blob to base64 string
     * @param {Blob} blob - Audio blob to convert
     * @returns {Promise<string>} - Base64 encoded audio
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Get the base64 part of the data URL
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Process recording to get transcription
     * @param {Blob} audioBlob - The recorded audio blob
     */
    async processRecording(audioBlob) {
        try {
            let mp3Blob = audioBlob;
            
            // Try to convert to MP3 if supported
            try {
                mp3Blob = await this.convertToMP3(audioBlob);
            } catch (conversionError) {
                console.warn('MP3 conversion failed, using original format:', conversionError.message);
                // Continue with original blob
                mp3Blob = audioBlob;
            }
            
            // Convert blob to base64 for API
            const base64Audio = await this.blobToBase64(mp3Blob);
            
            // Get transcription via API
            const transcription = await this.transcribeAudio(base64Audio);
            
            // Process the transcription result
            this.processTranscription(transcription);
        } catch (error) {
            console.error('Error processing recording:', error);
            throw error;
        }
    }

    /**
     * Convert WebM audio to MP3 format for better compatibility
     * @param {Blob} webmBlob - WebM audio blob from recorder
     * @returns {Promise<Blob>} - MP3 audio blob or original blob if conversion fails
     */
    convertToMP3(webmBlob) {
        return new Promise((resolve, reject) => {
            try {
                // Check if MP3 recording is supported
                if (!MediaRecorder.isTypeSupported('audio/mpeg')) {
                    console.log('MP3 recording not supported, using default format');
                    return resolve(webmBlob);
                }
                
                // Create audio element and set source
                const audio = new Audio();
                audio.src = URL.createObjectURL(webmBlob);
                
                // Set up event listeners
                audio.addEventListener('canplaythrough', () => {
                    try {
                        // Create audio context
                        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        const source = audioContext.createMediaElementSource(audio);
                        const dest = audioContext.createMediaStreamDestination();
                        
                        // Connect nodes
                        source.connect(dest);
                        
                        // Create a recorder for the stream
                        const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/mpeg' });
                        const chunks = [];
                        
                        // Set up recorder events
                        recorder.ondataavailable = (e) => {
                            if (e.data.size > 0) chunks.push(e.data);
                        };
                        
                        recorder.onstop = () => {
                            // Clean up
                            URL.revokeObjectURL(audio.src);
                            
                            // Create MP3 blob
                            const mp3Blob = new Blob(chunks, { type: 'audio/mpeg' });
                            resolve(mp3Blob);
                        };
                        
                        // Start recording and playback
                        recorder.start();
                        audio.play();
                        
                        // Stop when audio ends
                        audio.onended = () => {
                            recorder.stop();
                            audio.onended = null;
                        };
                        
                        // Safety timeout (5 minutes max)
                        setTimeout(() => {
                            if (recorder.state === 'recording') {
                                console.warn('MP3 conversion timed out, stopping');
                                recorder.stop();
                            }
                        }, 5 * 60 * 1000);
                    } catch (error) {
                        console.warn('Error during MP3 conversion setup:', error);
                        URL.revokeObjectURL(audio.src);
                        resolve(webmBlob); // Return original blob as fallback
                    }
                });
                
                audio.addEventListener('error', (error) => {
                    console.warn('Error loading audio for MP3 conversion:', error);
                    URL.revokeObjectURL(audio.src);
                    resolve(webmBlob); // Return original blob as fallback
                });
            } catch (error) {
                console.warn('MP3 conversion initialization error:', error);
                resolve(webmBlob); // Return original blob as fallback
            }
        });
    }

    /**
     * Transcribe audio using Whisper API with improved MP3 compatibility
     * @param {string} base64Audio - Base64 encoded audio
     * @returns {Promise<string>} - Transcription text
     */
    async transcribeAudio(base64Audio) {
        // For now, use a simple mock implementation
        // In a real implementation, this would call the Whisper API
        console.log('Transcribing audio...');
        
        // Get API key from localStorage
        const apiKey = localStorage.getItem('openai_api_key');
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }
        
        const formData = new FormData();
        
        // Convert base64 to a blob - use audio/mpeg mimetype for better compatibility
        const byteCharacters = atob(base64Audio);
        const byteArrays = [];
        for (let i = 0; i < byteCharacters.length; i += 512) {
            const slice = byteCharacters.slice(i, i + 512);
            const byteNumbers = new Array(slice.length);
            for (let j = 0; j < slice.length; j++) {
                byteNumbers[j] = slice.charCodeAt(j);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
        }
        const audioBlob = new Blob(byteArrays, { type: 'audio/mpeg' });
        
        // Add the file to FormData with mp3 extension for compatibility
        formData.append('file', audioBlob, 'recording.mp3');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');
        
        // Call the OpenAI API
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.text;
    }
    
    /**
     * Process transcription results with improved fallbacks
     * @param {string} transcription - The transcribed text
     */
    processTranscription(transcription) {
        try {
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            console.log(`Processing transcription, length: ${transcription?.length || 0}, additional mode: ${isAdditional || false}`);
            
            // For additional recording mode, update UI
            if (isAdditional) {
                const recordingStatus = document.getElementById('additional-recording-status');
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
            
            // TRY MULTIPLE METHODS TO HANDLE TRANSCRIPTION - PRIORITIZED BY RELIABILITY
            
            // 1. First try - if we're in additional recording mode, route directly to concept module
            if (isAdditional && this.uiManager && this.uiManager.conceptModule && 
                typeof this.uiManager.conceptModule.handleAdditionalRecordingComplete === 'function') {
                console.log('Using conceptModule.handleAdditionalRecordingComplete for additional recording');
                this.uiManager.conceptModule.handleAdditionalRecordingComplete(transcription);
                return;
            }
            
            // 2. Second try - use uiManager's handleTranscriptionComplete if available
            if (this.uiManager && typeof this.uiManager.handleTranscriptionComplete === 'function') {
                console.log('Using uiManager.handleTranscriptionComplete');
                this.uiManager.handleTranscriptionComplete(transcription);
                return;
            }
            
            // 3. Third try - check for global handler function
            if (window.handleTranscriptionComplete && typeof window.handleTranscriptionComplete === 'function') {
                console.log('Using global handleTranscriptionComplete function');
                window.handleTranscriptionComplete(transcription);
                return;
            }
            
            // 4. Fourth try - update textarea directly as last resort
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                console.log('Falling back to updating transcription textarea directly');
                
                if (isAdditional && transcriptionTextarea.value.trim()) {
                    // For additional recordings, append to existing text
                    const timestamp = new Date().toLocaleString();
                    transcriptionTextarea.value += `\n\n--- Additional Review (${timestamp}) ---\n${transcription}`;
                    
                    // Scroll to bottom to show new content
                    transcriptionTextarea.scrollTop = transcriptionTextarea.scrollHeight;
                    
                    // Highlight the update
                    transcriptionTextarea.classList.add('highlight-update');
                    setTimeout(() => {
                        transcriptionTextarea.classList.remove('highlight-update');
                    }, 1000);
                } else {
                    // For new recordings, replace text
                    transcriptionTextarea.value = transcription;
                }
                
                // Process concepts if possible
                if (this.uiManager && this.uiManager.conceptModule && 
                    typeof this.uiManager.conceptModule.processConcepts === 'function') {
                    this.uiManager.conceptModule.processConcepts(transcription);
                }
                
                return;
            }
            
            // If all else fails, log the transcription to console
            console.warn('uiManager not available or handleTranscriptionComplete not a function');
            console.log('Transcription result:', transcription);
        } catch (error) {
            console.error('Error processing transcription:', error);
        }
    }
}
