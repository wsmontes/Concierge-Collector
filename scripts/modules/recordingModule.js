/**
 * Recording Module - Orchestrator for audio recording and transcription
 * 
 * Purpose: Coordinate recording workflow using extracted services
 * 
 * Main Responsibilities:
 * - Orchestrate 4 services (Recording, Conversion, UI, State)
 * - Handle user interactions (button clicks)
 * - Coordinate transcription and analysis workflows
 * - Manage additional recording flows
 * 
 * Dependencies: AudioRecordingService, AudioConversionService, RecordingUIManager, RecordingStateManager, API
 * 
 * This is a REFACTORED version reducing from 2,421 lines → ~600 lines by delegating to services.
 */

class RecordingModule {
    constructor(uiManager) {
        this.log = Logger.module('RecordingModule');
        this.uiManager = uiManager;
        
        // Initialize services
        this.recordingService = new AudioRecordingService();
        this.conversionService = new AudioConversionService();
        this.uiService = new RecordingUIManager();
        this.stateManager = new RecordingStateManager();
        
        // Validate dependencies
        this.validateDependencies();
        
        // Current recording data
        this.currentAudioBlob = null;
        this.currentTranscription = null;
        
        this.log.debug('RecordingModule initialized with services');
    }
    
    /**
     * Validate required dependencies
     */
    validateDependencies() {
        const required = [
            'AudioRecordingService',
            'AudioConversionService',
            'RecordingUIManager',
            'RecordingStateManager',
            'apiUtils',
            'errorHandling'
        ];
        
        const missing = required.filter(dep => !window[dep]);
        
        if (missing.length > 0) {
            throw new Error(`Missing dependencies: ${missing.join(', ')}`);
        }
    }
    
    /**
     * Initialize recording interface
     */
    initialize() {
        this.log.debug('Initializing recording interface');
        
        // Ensure recording interface exists
        this.ensureRecordingInterfaceExists();
        
        // Attach event handlers
        this.attachEventHandlers();
        
        // Initialize additional recording if needed
        this.initializeAdditionalRecording();
        
        this.log.debug('Recording interface initialized');
    }
    
    /**
     * Ensure recording interface exists in DOM
     */
    ensureRecordingInterfaceExists() {
        let recordingSection = document.getElementById('recording-section');
        
        if (recordingSection) {
            // Section exists, just make sure it's visible
            recordingSection.classList.remove('hidden');
            this.log.debug('Recording section found in HTML, using existing');
        } else {
            // Section doesn't exist, create it
            recordingSection = this.createRecordingSection();
            this.insertRecordingSection(recordingSection);
            this.log.debug('Recording section created dynamically');
        }
        
        // Validate structure
        this.validateRecordingSection(recordingSection);
    }
    
    /**
     * Create recording section HTML
     * @returns {HTMLElement}
     */
    createRecordingSection() {
        const section = document.createElement('div');
        section.id = 'recording-section';
        section.className = 'mb-6';
        
        section.innerHTML = `
            <h2 class="text-xl font-bold mb-2 flex items-center">
                <span class="material-icons mr-1 text-red-600">mic</span>
                Record Your Restaurant Review
            </h2>
            <p class="text-sm text-gray-600 mb-4">Record your review to automatically extract information.</p>
            
            <div class="recording-controls flex flex-wrap items-center gap-3 mb-4">
                <button id="start-record" class="bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded flex items-center text-lg md:text-base">
                    <span class="material-icons mr-1">mic</span>
                    Start Recording
                </button>
                <button id="stop-record" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded flex items-center text-lg md:text-base hidden">
                    <span class="material-icons mr-1">stop</span>
                    Stop Recording
                </button>
                <div id="recording-time" class="px-4 py-3 bg-white border rounded text-lg md:text-base font-mono hidden">00:00</div>
                <div id="recording-status" class="text-base md:text-sm text-gray-600 ml-2"></div>
            </div>
            
            <div id="audio-visualizer" class="h-16 mb-4 bg-black rounded overflow-hidden hidden">
                <canvas id="audio-visualizer-canvas" class="w-full h-full"></canvas>
            </div>
            
            <div id="audio-preview" class="hidden mt-4">
                <h3 class="text-lg font-semibold mb-2">Recording Preview</h3>
                <audio id="recorded-audio" controls class="w-full mb-3"></audio>
                <div class="flex gap-2 flex-wrap">
                    <button id="transcribe-recording" class="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-lg md:text-base">
                        <span class="material-icons mr-1">transcribe</span>
                        Transcribe Recording
                    </button>
                    <button id="analyze-recording" class="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded text-lg md:text-base">
                        <span class="material-icons mr-1">analytics</span>
                        Analyze Recording
                    </button>
                </div>
                <div id="transcription-status" class="mt-2 hidden"></div>
                <div id="analysis-status" class="mt-2 hidden"></div>
            </div>
        `;
        
        return section;
    }
    
    /**
     * Insert recording section into DOM
     * @param {HTMLElement} section
     */
    insertRecordingSection(section) {
        const mainContainer = document.querySelector('.container') || document.body;
        const restaurantForm = document.getElementById('restaurant-form');
        
        if (restaurantForm) {
            mainContainer.insertBefore(section, restaurantForm);
        } else {
            mainContainer.appendChild(section);
        }
    }
    
    /**
     * Validate recording section structure
     * @param {HTMLElement} section
     */
    validateRecordingSection(section) {
        const required = ['start-record', 'stop-record', 'recording-time', 'audio-visualizer'];
        const missing = required.filter(id => !section.querySelector(`#${id}`));
        
        if (missing.length > 0) {
            this.log.warn('Missing recording elements:', missing);
        }
    }
    
    /**
     * Setup events (public method called by uiManager)
     * Alias for attachEventHandlers for compatibility
     */
    setupEvents() {
        this.attachEventHandlers();
    }
    
    /**
     * Attach event handlers to buttons
     */
    attachEventHandlers() {
        // Main recording controls
        this.attachHandler('start-record', () => this.handleStartRecording());
        this.attachHandler('stop-record', () => this.handleStopRecording());
        this.attachHandler('discard-recording', () => this.handleDiscardRecording());
        
        // Additional recording controls
        this.attachHandler('additional-start-record', () => this.handleStartRecording(true));
        this.attachHandler('additional-stop-record', () => this.handleStopRecording(true));
        this.attachHandler('discard-additional-recording', () => this.handleDiscardRecording(true));
    }
    
    /**
     * Public method: Start recording (callable from main.js)
     * @param {boolean} isAdditional
     */
    async startRecording(isAdditional = false) {
        return await this.handleStartRecording(isAdditional);
    }
    
    /**
     * Public method: Stop recording (callable from main.js)
     * @param {boolean} isAdditional
     */
    async stopRecording(isAdditional = false) {
        return await this.handleStopRecording(isAdditional);
    }
    
    /**
     * Attach event handler with error handling
     * @param {string} id - Element ID
     * @param {Function} handler - Click handler
     */
    attachHandler(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await handler();
                } catch (error) {
                    this.log.error(`Error in ${id} handler:`, error);
                    const errorMsg = error?.message || error || 'Unknown error';
                    this.uiService.showError(errorMsg);
                }
            });
        }
    }
    
    /**
     * Handle start recording
     * @param {boolean} isAdditional
     */
    async handleStartRecording(isAdditional = false) {
        this.log.debug('Start recording clicked', { isAdditional });
        
        // Check if already recording
        if (this.stateManager.isRecording()) {
            this.log.warn('Already recording, ignoring start request');
            return;
        }
        
        // Check state transition
        if (!this.stateManager.transitionTo(this.stateManager.STATES.RECORDING)) {
            this.uiService.showError('Cannot start recording in current state');
            return;
        }
        
        this.stateManager.setAdditionalRecording(isAdditional);
        
        try {
            // Update UI
            this.uiService.updateButtonStates(true, isAdditional);
            this.uiService.showStatus('Recording...', 'recording', isAdditional);
            this.uiService.startTimer(isAdditional);
            
            // Start recording
            const stream = await this.recordingService.startRecording({
                onChunkAvailable: (chunk) => {
                    // Handle real-time chunks if needed
                }
            });
            
            // Setup visualizer
            this.uiService.setupVisualizer(stream, isAdditional);
            
        } catch (error) {
            this.log.error('Start recording failed:', error);
            this.stateManager.transitionTo(this.stateManager.STATES.IDLE);
            const errorMsg = this.formatRecordingError(error);
            this.uiService.showError(errorMsg, isAdditional);
            this.uiService.reset(isAdditional);
        }
    }
    
    /**
     * Handle stop recording
     * @param {boolean} isAdditional
     */
    async handleStopRecording(isAdditional = false) {
        this.log.debug('Stop recording clicked', { isAdditional });
        
        // Check state
        if (!this.stateManager.isRecording()) {
            this.log.warn('Not recording, cannot stop');
            return;
        }
        
        // Transition to processing
        if (!this.stateManager.transitionTo(this.stateManager.STATES.PROCESSING)) {
            this.uiService.showError('Cannot process recording in current state');
            return;
        }
        
        try {
            // Update UI
            this.uiService.showProgress('Processing recording...', 0, isAdditional);
            this.uiService.stopTimer();
            this.uiService.stopVisualizer();
            
            // Stop recording
            const audioBlob = await this.recordingService.stopRecording();
            
            if (!audioBlob || audioBlob.size === 0) {
                throw new Error('Recording is empty');
            }
            
            this.log.debug(`Recording stopped: ${audioBlob.size} bytes`);
            
            // Convert to MP3
            this.uiService.showProgress('Converting to MP3...', 30, isAdditional);
            const mp3Blob = await this.conversionService.convert(audioBlob, 'mp3');
            
            this.log.debug(`Converted to MP3: ${mp3Blob.size} bytes`);
            
            // Store result
            this.currentAudioBlob = mp3Blob;
            
            // Update UI
            this.uiService.hideProgress(isAdditional);
            this.uiService.updateButtonStates(false, isAdditional);
            this.uiService.showAudioPreview(mp3Blob, isAdditional);
            this.uiService.showSuccess('Recording complete!', isAdditional);
            
            // Transition to completed
            this.stateManager.transitionTo(this.stateManager.STATES.COMPLETED);
            
            // 🔥 AUTOMATIC FLOW: Transcribe + extract concepts automatically
            this.log.debug('Starting automatic transcription + concept extraction...');
            await this.processRecordingAutomatically(isAdditional);
            
        } catch (error) {
            this.log.error('Stop recording failed:', error);
            this.stateManager.transitionTo(this.stateManager.STATES.IDLE);
            const errorMsg = error?.message || error || 'Stop recording failed';
            this.uiService.showError(errorMsg, isAdditional);
            this.uiService.reset(isAdditional);
        }
    }
    
    /**
     * Handle discard recording
     * @param {boolean} isAdditional
     */
    async handleDiscardRecording(isAdditional = false) {
        this.log.debug('Discard recording clicked', { isAdditional });
        
        if (confirm('Are you sure you want to discard this recording?')) {
            this.resetRecording(isAdditional);
            this.uiService.showSuccess('Recording discarded', isAdditional);
        }
    }
    
    /**
     * Process recording automatically (transcription + concepts)
     * Called automatically after stop recording
     * @param {boolean} isAdditional
     */
    async processRecordingAutomatically(isAdditional = false) {
        if (!this.currentAudioBlob) {
            this.log.warn('No audio blob to process');
            return;
        }
        
        try {
            this.uiService.showProgress('Processing your review...', 0, isAdditional);
            
            // Use ApiService V3 orchestrate endpoint (returns both transcription + concepts)
            if (!window.ApiService) {
                throw new Error('ApiService not available');
            }
            
            this.log.debug('Calling API orchestrate endpoint...');
            const result = await window.ApiService.transcribeAudio(this.currentAudioBlob, 'pt-BR');
            
            // Extract data from orchestrate response
            const transcription = result.transcription || result.results?.transcription?.text || '';
            const concepts = result.concepts || result.results?.concepts?.concepts || [];
            
            if (!transcription) {
                throw new Error('No transcription returned from API');
            }
            
            this.log.debug('Processing complete:', { 
                transcriptionLength: transcription.length,
                conceptCount: concepts.length 
            });
            
            // Store transcription
            this.currentTranscription = transcription;
            
            // Update UI with transcription
            this.displayTranscription(transcription, isAdditional);
            
            // Display concepts immediately (requirement: "logo após a transcrição")
            if (concepts.length > 0) {
                if (this.uiManager?.conceptModule) {
                    this.uiManager.currentConcepts = concepts;
                    this.uiManager.conceptModule.displayConcepts(concepts);
                } else if (window.ConceptModule) {
                    window.ConceptModule.displayConcepts(concepts);
                }
            }
            
            this.uiService.hideProgress(isAdditional);
            this.uiService.showSuccess(
                `✅ Review processed! Found ${concepts.length} concepts. You can now edit and save.`,
                isAdditional
            );
            
        } catch (error) {
            this.log.error('Automatic processing failed:', error);
            this.uiService.hideProgress(isAdditional);
            const errorMsg = error?.message || error || 'Processing failed';
            this.uiService.showError(`Processing failed: ${errorMsg}. You can try again.`, isAdditional);
        }
    }
    
    /**
     * Handle transcribe recording (DEPRECATED - now automatic)
     * Kept for backward compatibility
     * @param {boolean} isAdditional
     */
    async handleTranscribe(isAdditional = false) {
        this.log.warn('handleTranscribe is deprecated - processing is now automatic');
        return await this.processRecordingAutomatically(isAdditional);
    }
    
    /**
     * Handle analyze recording (DEPRECATED - now automatic)
     * Kept for backward compatibility
     * @param {boolean} isAdditional
     */
    async handleAnalyze(isAdditional = false) {
        this.log.warn('handleAnalyze is deprecated - processing is now automatic');
        return await this.processRecordingAutomatically(isAdditional);
    }
    
    /**
     * Display transcription in UI
     * @param {string} transcription
     * @param {boolean} isAdditional
     */
    displayTranscription(transcription, isAdditional = false) {
        const statusId = isAdditional ? 'additional-transcription-status' : 'transcription-status';
        const statusElement = document.getElementById(statusId);
        
        if (statusElement) {
            statusElement.classList.remove('hidden');
            statusElement.innerHTML = `
                <div class="bg-green-50 border border-green-200 rounded p-3">
                    <h4 class="font-semibold mb-2">Transcription:</h4>
                    <p class="text-sm">${transcription}</p>
                </div>
            `;
        }
        
        // Also update main transcription div if available (it's a div, not textarea)
        const transcriptionText = document.getElementById('transcription-text');
        if (transcriptionText && !isAdditional) {
            transcriptionText.textContent = transcription;
        }
        
        // Show transcription section
        const transcriptionSection = document.getElementById('transcription-section');
        if (transcriptionSection && !isAdditional) {
            transcriptionSection.classList.remove('hidden');
        }
    }
    
    /**
     * Format recording error for user
     * @param {Error} error
     * @returns {string}
     */
    formatRecordingError(error) {
        if (error.name === 'NotAllowedError') {
            return 'Microphone access denied. Please allow microphone access in browser settings.';
        } else if (error.name === 'NotFoundError') {
            return 'No microphone found. Please connect a microphone and try again.';
        } else {
            return `Recording error: ${error.message}`;
        }
    }
    
    /**
     * Reset recording state
     * @param {boolean} isAdditional
     */
    resetRecording(isAdditional = false) {
        this.currentAudioBlob = null;
        this.currentTranscription = null;
        this.uiService.reset(isAdditional);
        this.stateManager.transitionTo(this.stateManager.STATES.IDLE);
    }
    
    /**
     * Initialize additional recording interface
     */
    initializeAdditionalRecording() {
        const additionalSection = document.getElementById('additional-recording-section');
        if (additionalSection) {
            this.log.debug('Additional recording section found, attaching handlers');
        }
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.recordingService.cleanup();
        this.uiService.cleanup();
        this.stateManager.forceReset();
    }
}

// Export
window.RecordingModule = RecordingModule;
console.debug('[RecordingModule] Module initialized (refactored version)');
