/**
 * Recording Module - Handles audio recording and transcription
 * Dependencies: Whisper API, uiManager
 * Enhanced for mobile compatibility and consistent MP3 conversion
 */
class RecordingModule {
    constructor(uiManager) {
        // Create module logger instance
        this.log = Logger.module("RecordingModule");
        
        this.uiManager = uiManager;
        this.isRecording = false;
        this.isAdditionalRecording = false; // New flag to track additional recording state
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.audioChunks = [];
        this.visualizationFrame = null;
        this.audioContext = null;
        this.analyser = null;
        this.recordingTimer = null;
        this.recordingStartTime = null;
        
        // Default settings for audio recording
        this.recordingSettings = {
            mimeType: null, // Will be determined at runtime based on browser support
            audioBitsPerSecond: 128000, // 128kbps for decent audio quality
            maxDuration: 5 * 60 * 1000 // 5 minute maximum recording time
        };
        
        // Initialize the supported mime type based on browser capabilities
        this.initMimeType();
    }

    /**
     * Initialize the best supported mime type for the current browser
     */
    initMimeType() {
        // Try different mime types in order of preference
        const mimeTypes = [
            'audio/webm;codecs=opus',  // Best quality on most browsers
            'audio/webm',              // Generic webm
            'audio/mp4',               // iOS fallback
            'audio/ogg;codecs=opus',   // Firefox fallback
            'audio/mpeg'               // Last resort
        ];
        
        // Find the first supported mime type
        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                this.recordingSettings.mimeType = mimeType;
                this.log.debug(`Selected recording format: ${mimeType}`);
                break;
            }
        }
        
        // If no supported type is found, let browser use default
        if (!this.recordingSettings.mimeType) {
            this.log.warn('No explicit MIME type support detected, using browser default');
        }
    }

    /**
     * Creates and initializes the recording interface if not already present
     * @returns {void}
     */
    ensureRecordingInterfaceExists() {
        this.log.debug('Ensuring recording interface exists in the DOM');
        
        // First, check if there are duplicate recording controls and remove them
        this.removeDuplicateRecordingControls();
        
        // Check if the recording section exists
        let recordingSection = document.getElementById('recording-section');
        
        // If it doesn't exist, we need to create it
        if (!recordingSection) {
            this.log.debug('Recording section not found, creating it');
            recordingSection = document.createElement('div');
            recordingSection.id = 'recording-section';
            recordingSection.className = 'mb-6';
            
            // Create the recording section HTML - enhanced for mobile with larger tap targets
            recordingSection.innerHTML = `
                <h2 class="text-xl font-bold mb-2 flex items-center">
                    <span class="material-icons mr-1 text-red-600">mic</span>
                    Record Your Restaurant Review
                </h2>
                <p class="text-sm text-gray-600 mb-4">Record your review of the restaurant to automatically extract information.</p>
                
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
                
                <!-- Circular timer and audio preview section -->
                <div id="circular-timer-section" class="hidden">
                    <div id="timer" class="text-center text-4xl font-bold mb-2">00:00</div>
                    <div class="flex justify-center gap-2">
                        <button id="discard-recording" class="px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded text-lg md:text-base">
                            <span class="material-icons mr-1">delete</span>
                            Discard Recording
                        </button>
                    </div>
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
                    <div id="transcription-status" class="mt-2 hidden">
                        <span class="material-icons text-yellow-500 mr-1">pending</span>
                        Transcribing your audio...
                    </div>
                    <div id="analysis-status" class="mt-2 hidden">
                        <span class="material-icons text-yellow-500 mr-1">pending</span>
                        Analyzing restaurant details...
                    </div>
                </div>
            `;
            
            // Find the appropriate place to insert the recording section
            const mainContainer = document.querySelector('.container') || document.body;
            const restaurantForm = document.getElementById('restaurant-form');
            
            if (restaurantForm) {
                // Insert before the restaurant form
                mainContainer.insertBefore(recordingSection, restaurantForm);
            } else {
                // Append to main container if form not found
                mainContainer.appendChild(recordingSection);
            }
            
            this.log.debug('Recording section created and added to the DOM');
        } else {
            this.log.debug('Recording section already exists');
            
            // Check if the section has the correct structure - if not, repair it
            const startBtn = recordingSection.querySelector('#start-record');
            const stopBtn = recordingSection.querySelector('#stop-record');
            
            if (!startBtn || !stopBtn) {
                this.log.debug('Recording buttons missing - repairing recording section structure');
                
                // Find the controls container or create one
                let controlsContainer = recordingSection.querySelector('.recording-controls');
                if (!controlsContainer) {
                    controlsContainer = document.createElement('div');
                    controlsContainer.className = 'recording-controls flex flex-wrap items-center gap-3 mb-4';
                    recordingSection.appendChild(controlsContainer);
                } else {
                    // Clear existing buttons to prevent duplicates
                    controlsContainer.innerHTML = '';
                }
                
                // Add start button with mobile-friendly styling
                const newStartBtn = document.createElement('button');
                newStartBtn.id = 'start-record';
                newStartBtn.className = 'bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded flex items-center text-lg md:text-base';
                newStartBtn.innerHTML = '<span class="material-icons mr-1">mic</span>Start Recording';
                controlsContainer.appendChild(newStartBtn);
                this.log.debug('Added missing start-record button');
                
                // Add stop button with mobile-friendly styling
                const newStopBtn = document.createElement('button');
                newStopBtn.id = 'stop-record';
                newStopBtn.className = 'bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded flex items-center text-lg md:text-base hidden';
                newStopBtn.innerHTML = '<span class="material-icons mr-1">stop</span>Stop Recording';
                controlsContainer.appendChild(newStopBtn);
                this.log.debug('Added missing stop-record button');
                
                // Add recording time display if missing
                if (!recordingSection.querySelector('#recording-time')) {
                    const timeDisplay = document.createElement('div');
                    timeDisplay.id = 'recording-time';
                    timeDisplay.className = 'px-4 py-3 bg-white border rounded text-lg md:text-base font-mono hidden';
                    timeDisplay.textContent = '00:00';
                    controlsContainer.appendChild(timeDisplay);
                }
                
                // Add recording status display if missing
                if (!recordingSection.querySelector('#recording-status')) {
                    const statusDisplay = document.createElement('div');
                    statusDisplay.id = 'recording-status';
                    statusDisplay.className = 'text-base md:text-sm text-gray-600 ml-2';
                    controlsContainer.appendChild(statusDisplay);
                }
                
                // Add visualizer if missing
                if (!recordingSection.querySelector('#audio-visualizer')) {
                    const visualizer = document.createElement('div');
                    visualizer.id = 'audio-visualizer';
                    visualizer.className = 'h-16 mb-4 bg-black rounded overflow-hidden hidden';
                    visualizer.innerHTML = '<canvas id="audio-visualizer-canvas" class="w-full h-full"></canvas>';
                    recordingSection.appendChild(visualizer);
                }
            }
        }
        
        // Double check that buttons exist after creation/repair
        const startBtn = document.getElementById('start-record');
        const stopBtn = document.getElementById('stop-record');
        
        // Log any remaining issues
        if (!startBtn) {
            this.log.warn('Start record button still missing after section creation/repair');
        }
        
        if (!stopBtn) {
            this.log.warn('Stop record button still missing after section creation/repair');
        }
    }

    /**
     * Remove any duplicate recording controls to ensure clean interface
     */
    removeDuplicateRecordingControls() {
        // First identify all recording controls sections
        const recordingControlsElements = document.querySelectorAll('.recording-controls');
        
        // Keep track of duplicate round buttons
        const roundButtons = document.querySelectorAll('button.rounded-full');
        const roundRecordButtons = Array.from(roundButtons).filter(btn => {
            // Check if this is a recording button by looking at the icon or text
            return btn.innerHTML.includes('mic') || 
                   btn.innerHTML.toLowerCase().includes('record') || 
                   btn.innerHTML.includes('stop');
        });
        
        // Remove duplicate round buttons
        roundRecordButtons.forEach(btn => {
            this.log.debug('Removing round button:', btn.outerHTML);
            if (btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        });
        
        // If we have more than one recording controls section, keep only the first one
        if (recordingControlsElements.length > 1) {
            this.log.debug(`Found ${recordingControlsElements.length} recording control sections, removing duplicates`);
            
            // Keep the first one, remove the rest
            for (let i = 1; i < recordingControlsElements.length; i++) {
                const element = recordingControlsElements[i];
                this.log.debug('Removing duplicate recording controls:', element.outerHTML);
                
                // Only remove if it's not part of the additional recording section
                const isAdditionalRecording = element.closest('#additional-recording-section');
                if (!isAdditionalRecording && element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }
        }
    }

    /**
     * Looks for alternative record buttons that might be present with different IDs
     * @param {string} type - 'start' or 'stop'
     * @returns {HTMLElement|null} - The found button or null
     */
    lookForAlternativeRecordButtons(type) {
        this.log.debug(`Looking for alternative ${type} record buttons...`);
        
        // Try different ID formats and selectors
        const possibleIds = [
            `${type}-record`,
            `${type}-recording`,
            `${type}_record`,
            `${type}_recording`,
            `record-${type}`,
            `recording-${type}`,
            `record_${type}`,
            `recording_${type}`
        ];
        
        // Try to find by ID
        for (const id of possibleIds) {
            const btn = document.getElementById(id);
            if (btn) {
                this.log.debug(`Found alternative ${type} button with ID: ${id}`);
                // Clone and replace with correct ID
                this.replaceWithCorrectButton(btn, type);
                return btn;
            }
        }
        
        // Try to find by content/text
        const textMatches = {
            'start': ['start recording', 'record', 'begin recording', 'start'],
            'stop': ['stop recording', 'stop', 'end recording']
        };
        
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            const buttonText = btn.textContent.toLowerCase();
            if (textMatches[type].some(match => buttonText.includes(match))) {
                this.log.debug(`Found ${type} button by text content`);
                this.replaceWithCorrectButton(btn, type);
                return btn;
            }
        }
        
        // Finally check for buttons with mic icon for start or stop icon for stop
        const iconSelectors = {
            'start': '.material-icons:contains("mic"), i:contains("mic"), span:contains("mic")',
            'stop': '.material-icons:contains("stop"), i:contains("stop"), span:contains("stop")'
        };
        
        // This is a simplified approach - in reality we'd need to handle jQuery selectors differently
        try {
            const iconElements = document.querySelectorAll('.material-icons, i, span');
            for (const icon of Array.from(iconElements)) {
                if (icon.textContent.includes(type === 'start' ? 'mic' : 'stop')) {
                    const btn = icon.closest('button');
                    if (btn) {
                        this.log.debug(`Found ${type} button by icon`);
                        this.replaceWithCorrectButton(btn, type);
                        return btn;
                    }
                }
            }
        } catch (e) {
            this.log.warn('Error finding buttons by icon:', e);
        }
        
        this.log.debug(`No alternative ${type} button found`);
        return null;
    }

    /**
     * Replaces a found button with one having the correct ID
     * @param {HTMLElement} btn - The found button
     * @param {string} type - 'start' or 'stop'
     */
    replaceWithCorrectButton(btn, type) {
        try {
            // Create replacement button with correct ID
            const newBtn = document.createElement('button');
            newBtn.id = `${type}-record`;
            newBtn.className = btn.className || (type === 'start' ? 
                'bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded flex items-center' : 
                'bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded flex items-center');
            
            if (type === 'stop') {
                newBtn.classList.add('hidden');
            }
            
            newBtn.innerHTML = btn.innerHTML || (type === 'start' ? 
                '<span class="material-icons mr-1">mic</span>Start Recording' : 
                '<span class="material-icons mr-1">stop</span>Stop Recording');
            
            // Replace the original button
            if (btn.parentNode) {
                btn.parentNode.replaceChild(newBtn, btn);
                this.log.debug(`Replaced ${type} button with correct ID`);
            }
        } catch (e) {
            this.log.error(`Error replacing ${type} button:`, e);
        }
    }

    /**
     * Setup event listeners for recording functionality with enhanced button finding
     */
    setupEvents() {
        this.log.debug('Setting up recording events...');
        
        // Ensure recording interface exists before trying to attach events
        this.ensureRecordingInterfaceExists();
        
        // Wait a short moment to ensure DOM updates are applied
        setTimeout(() => {
            // Try again to make sure interface exists
            this.ensureRecordingInterfaceExists();
            
            // First try direct event attachment
            let foundButtons = this.attachMainRecordingEvents();
            
            // If buttons weren't found, try using event delegation as fallback
            if (!foundButtons) {
                this.setupEventDelegation();
            }
            
            // Additional recording buttons (may not exist yet)
            this.attachAdditionalRecordingEvents();
            
            // Setup a mutation observer to catch dynamically added buttons
            this.setupDynamicButtonObserver();
            
            this.log.debug('Recording events setup completed');
        }, 100);
    }

    /**
     * Attaches event handlers to main recording buttons
     * @returns {boolean} - Whether both buttons were found
     */
    attachMainRecordingEvents() {
        // Start recording button
        const startRecordBtn = document.getElementById('start-record');
        const stopRecordBtn = document.getElementById('stop-record');
        
        let startBtnFound = false, stopBtnFound = false;
        
        if (startRecordBtn) {
            this.log.debug('Found start-record button, attaching event listener');
            
            // Remove any existing listeners to prevent duplicates
            startRecordBtn.removeEventListener('click', this.handleStartRecording);
            
            // Create bound method for the event handler
            this.handleStartRecording = this.handleStartRecording || this.startRecording.bind(this);
            
            // Add the event listener
            startRecordBtn.addEventListener('click', this.handleStartRecording);
            
            // Add debug marker to confirm attachment
            startRecordBtn.dataset.hasClickListener = 'true';
            startBtnFound = true;
        } else {
            this.log.warn('Start recording button not found in DOM');
        }
        
        // Stop recording button
        if (stopRecordBtn) {
            this.log.debug('Found stop-record button, attaching event listener');
            
            // Remove any existing listeners
            stopRecordBtn.removeEventListener('click', this.handleStopRecording);
            
            // Create bound method
            this.handleStopRecording = this.handleStopRecording || this.stopRecording.bind(this);
            
            // Add the event listener
            stopRecordBtn.addEventListener('click', this.handleStopRecording);
            
            // Add debug marker
            stopRecordBtn.dataset.hasClickListener = 'true';
            stopBtnFound = true;
        } else {
            this.log.warn('Stop recording button not found in DOM');
        }
        
        return startBtnFound && stopBtnFound;
    }

    /**
     * Attaches event handlers to additional recording buttons if they exist
     */
    attachAdditionalRecordingEvents() {
        // Additional recording start button
        const additionalStartBtn = document.getElementById('additional-record-start');
        if (additionalStartBtn) {
            this.log.debug('Found additional-record-start button, attaching event listener');
            
            // Remove any existing listeners
            additionalStartBtn.removeEventListener('click', this.handleAdditionalStartRecording);
            
            // Create handler that sets the additional flag and calls startRecording
            this.handleAdditionalStartRecording = this.handleAdditionalStartRecording || (async () => {
                this.log.debug('Additional record start button clicked');
                if (this.uiManager) {
                    this.uiManager.isRecordingAdditional = true;
                }
                try {
                    await this.startRecording();
                } catch (error) {
                    this.log.error('Error starting additional recording:', error);
                    // Reset the state on error using the centralized method
                    this.resetRecordingState();
                    
                    // Show error notification
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        window.uiUtils.showNotification('Error starting recording: ' + error.message, 'error');
                    }
                }
            });
            
            // Add the event listener
            additionalStartBtn.addEventListener('click', this.handleAdditionalStartRecording);
            
            // Add debug marker
            additionalStartBtn.dataset.hasClickListener = 'true';
        }
        
        // Additional recording stop button
        const additionalStopBtn = document.getElementById('additional-record-stop');
        if (additionalStopBtn) {
            this.log.debug('Found additional-record-stop button, attaching event listener');
            
            // Remove any existing listeners
            additionalStopBtn.removeEventListener('click', this.handleAdditionalStopRecording);
            
            // Create handler that calls stopRecording
            this.handleAdditionalStopRecording = this.handleAdditionalStopRecording || (async () => {
                this.log.debug('Additional record stop button clicked');
                try {
                    await this.stopRecording();
                } catch (error) {
                    this.log.error('Error stopping additional recording:', error);
                    // Show error notification
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        window.uiUtils.showNotification('Error stopping recording: ' + error.message, 'error');
                    }
                }
            });
            
            // Add the event listener
            additionalStopBtn.addEventListener('click', this.handleAdditionalStopRecording);
            
            // Add debug marker
            additionalStopBtn.dataset.hasClickListener = 'true';
        }
    }

    /**
     * Sets up an observer to watch for dynamically added recording buttons
     */
    setupDynamicButtonObserver() {
        // Cancel any existing observer
        if (this.buttonObserver) {
            this.buttonObserver.disconnect();
        }
        
        // Create a new observer that watches for button additions
        this.buttonObserver = new MutationObserver((mutations) => {
            let shouldAttachEventListeners = false;
            
            // Check if any relevant buttons were added
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if this is a recording button or contains one
                            if (node.id === 'additional-record-start' || 
                                node.id === 'additional-record-stop' || 
                                node.id === 'start-record' || 
                                node.id === 'stop-record' || 
                                node.querySelector('#additional-record-start, #additional-record-stop, #start-record, #stop-record')) {
                                shouldAttachEventListeners = true;
                                break;
                            }
                        }
                    }
                }
                
                if (shouldAttachEventListeners) break;
            }
            
            // If we found relevant buttons, reattach event handlers
            if (shouldAttachEventListeners) {
                this.log.debug('Recording buttons dynamically added, reattaching event listeners');
                setTimeout(() => {
                    this.attachMainRecordingEvents();
                    this.attachAdditionalRecordingEvents();
                }, 100); // Small delay to ensure DOM is settled
            }
        });
        
        // Start observing
        this.buttonObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Set a timeout to prevent memory leaks if page is left open for long periods
        setTimeout(() => {
            if (this.buttonObserver) {
                this.log.debug('Stopping button observer after timeout');
                this.buttonObserver.disconnect();
                this.buttonObserver = null;
            }
        }, 3600000); // 1 hour
    }

    /**
     * Sets the recording state with synchronized UI updates
     * @param {boolean} isRecording - Whether recording is active
     * @param {boolean} isAdditional - Whether this is an additional recording
     */
    setRecordingState(isRecording, isAdditional = false) {
        this.log.debug(`Setting recording state: isRecording=${isRecording}, isAdditional=${isAdditional}`);
        
        // Update module state
        this.isRecording = isRecording;
        this.isAdditionalRecording = isAdditional;
        
        // Synchronize with UI manager if available
        if (this.uiManager) {
            this.uiManager.isRecordingAdditional = isAdditional;
        }
        
        // Update recording indicator UI elements
        this.updateRecordingIndicators(isRecording, isAdditional);
    }
    
    /**
     * Resets the recording state completely
     */
    resetRecordingState() {
        this.log.debug('Resetting recording state');
        
        // Reset module state
        this.isRecording = false;
        this.isAdditionalRecording = false;
        
        // Clean up media resources
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                }
            } catch (e) {
                this.log.warn('Error stopping mediaRecorder during reset:', e);
            }
            this.mediaRecorder = null;
        }
        
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(track => track.stop());
            } catch (e) {
                this.log.warn('Error stopping mediaStream tracks during reset:', e);
            }
            this.mediaStream = null;
        }
        
        // Reset chunks array
        this.audioChunks = [];
        
        // Stop visualization and timer
        this.stopVisualization();
        this.stopRecordingTimer();
        
        // Synchronize with UI manager
        if (this.uiManager) {
            this.uiManager.isRecordingAdditional = false;
        }
        
        // Update UI elements
        this.updateRecordingIndicators(false, false);
    }
    
    /**
     * Updates UI elements to reflect current recording state
     * @param {boolean} isRecording - Whether recording is active
     * @param {boolean} isAdditional - Whether this is an additional recording
     */
    updateRecordingIndicators(isRecording, isAdditional) {
        try {
            // Handle main recording UI elements
            const startBtn = document.getElementById('start-record');
            const stopBtn = document.getElementById('stop-record');
            const recordingTime = document.getElementById('recording-time');
            const recordingStatus = document.getElementById('recording-status');
            const audioVisualizer = document.getElementById('audio-visualizer');
            
            // Handle additional recording UI elements
            const additionalStartBtn = document.getElementById('additional-record-start');
            const additionalStopBtn = document.getElementById('additional-record-stop');
            const additionalRecordingTime = document.getElementById('additional-recording-time');
            const additionalRecordingStatus = document.getElementById('additional-recording-status');
            const additionalAudioVisualizer = document.getElementById('additional-audio-visualizer');
            
            if (isRecording) {
                // Show/hide appropriate buttons based on recording mode
                if (isAdditional) {
                    // Additional recording mode UI
                    if (additionalStartBtn) additionalStartBtn.classList.add('hidden');
                    if (additionalStopBtn) additionalStopBtn.classList.remove('hidden');
                    if (additionalRecordingTime) additionalRecordingTime.classList.remove('hidden');
                    if (additionalAudioVisualizer) additionalAudioVisualizer.classList.remove('hidden');
                    if (additionalRecordingStatus) {
                        additionalRecordingStatus.innerHTML = `
                            <div class="flex items-center text-purple-700">
                                <span class="recording-indicator additional-recording"></span>
                                <span>Recording Additional Review...</span>
                            </div>
                        `;
                    }
                } else {
                    // Standard recording mode UI
                    if (startBtn) startBtn.classList.add('hidden');
                    if (stopBtn) stopBtn.classList.remove('hidden');
                    if (recordingTime) recordingTime.classList.remove('hidden');
                    if (audioVisualizer) audioVisualizer.classList.remove('hidden');
                    if (recordingStatus) {
                        recordingStatus.innerHTML = `
                            <div class="flex items-center text-red-700">
                                <span class="recording-indicator"></span>
                                <span>Recording...</span>
                            </div>
                        `;
                    }
                }
            } else {
                // Reset UI for both recording modes
                if (startBtn) startBtn.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
                if (recordingTime) recordingTime.classList.add('hidden');
                if (audioVisualizer) audioVisualizer.classList.add('hidden');
                
                if (additionalStartBtn) additionalStartBtn.classList.remove('hidden');
                if (additionalStopBtn) additionalStopBtn.classList.add('hidden');
                if (additionalRecordingTime) additionalRecordingTime.classList.add('hidden');
                if (additionalAudioVisualizer) additionalAudioVisualizer.classList.add('hidden');
                
                // Reset status displays
                if (recordingStatus) recordingStatus.textContent = '';
                if (additionalRecordingStatus) additionalRecordingStatus.textContent = '';
            }
        } catch (error) {
            this.log.error('Error updating recording indicators:', error);
        }
    }

    /**
     * Starts recording audio with support for both regular and additional recording modes
     * Enhanced for mobile compatibility
     * @returns {Promise<void>}
     */
    async startRecording() {
        try {
            // Determine if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            this.log.debug(`Starting recording, additional mode: ${isAdditional}`);
            
            // Prevent starting a new recording if one is already in progress
            if (this.isRecording) {
                this.log.warn('Recording already in progress, cannot start another');
                return;
            }
            
            // Set the recording state first
            this.setRecordingState(true, isAdditional);
            
            // Basic browser support check
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Audio recording not supported in this browser');
            }
            
            // Request audio stream with constraints optimized for voice
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100 // CD quality for best transcription results
                }
            };
            
            // For iOS Safari, we need special handling
            if (this.isIOSSafari()) {
                this.log.debug('iOS Safari detected, using simplified audio constraints');
                constraints.audio = true; // Simple constraints for iOS
            }
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.mediaStream = stream;
            
            // Create media recorder with best supported MIME type
            const options = {};
            if (this.recordingSettings.mimeType) {
                options.mimeType = this.recordingSettings.mimeType;
            }
            if (this.recordingSettings.audioBitsPerSecond) {
                options.audioBitsPerSecond = this.recordingSettings.audioBitsPerSecond;
            }
            
            // Debug info for mobile debugging
            this.log.debug('Creating MediaRecorder with options:', options);
            
            try {
                this.mediaRecorder = new MediaRecorder(stream, options);
            } catch (err) {
                this.log.warn(`Error creating MediaRecorder with options: ${err.message}, trying without options`);
                this.mediaRecorder = new MediaRecorder(stream);
            }
            
            this.audioChunks = [];
            
            // Set up event handlers
            this.mediaRecorder.addEventListener('dataavailable', e => {
                if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
            });
            
            // Add safety auto-stop after max duration
            const maxRecordingDuration = this.recordingSettings.maxDuration || 5 * 60 * 1000; // 5 minute default
            setTimeout(() => {
                if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.log.debug('Auto-stopping recording due to max duration limit');
                    this.stopRecording().catch(err => this.log.error('Error auto-stopping recording:', err));
                }
            }, maxRecordingDuration);
            
            // Start recording with 1 second chunks for more responsive recording
            this.mediaRecorder.start(1000);
            
            // Hide audio preview if it was shown from previous recording
            const audioPreview = document.getElementById('audio-preview');
            if (audioPreview) {
                audioPreview.classList.add('hidden');
            }
            
            // Initialize the audio context for visualization
            if (typeof this.setupVisualization === 'function') {
                this.setupVisualization(isAdditional);
            }
            
            // Start the timer for both displays
            this.startRecordingTimer();
            
        } catch (error) {
            this.log.error('Error starting recording:', error);
            
            // Reset state on error
            this.resetRecordingState();
            
            // Special handling for common mobile issues
            if (error.name === 'NotAllowedError') {
                alert('Microphone access denied. Please allow microphone access in your browser settings to record audio.');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please connect a microphone and try again.');
            }
            
            // Throw the error for handling upstream
            throw error;
        }
    }

    /**
     * Stops recording audio and shows preview
     * Enhanced with improved MP3 conversion for Whisper API
     */
    async stopRecording() {
        try {
            // Can't stop if not recording
            if (!this.isRecording || !this.mediaRecorder) {
                this.log.debug('No active recording to stop');
                return;
            }
            
            // Only stop if active
            if (this.mediaRecorder.state === 'inactive') {
                this.log.debug('Media recorder already inactive');
                return;
            }
            
            // Determine recording mode before resetting state
            const isAdditional = this.isAdditionalRecording;
            this.log.debug(`Stopping recording, additional mode: ${isAdditional}`);
            
            // Get recording status element for updating during processing
            const recordingStatus = isAdditional ?
                document.getElementById('additional-recording-status') :
                document.getElementById('recording-status');
            
            if (recordingStatus) {
                recordingStatus.innerHTML = `
                    <div class="flex items-center ${isAdditional ? 'text-purple-700' : 'text-blue-700'}">
                        <span class="material-icons text-${isAdditional ? 'purple' : 'blue'}-500 mr-1">hourglass_top</span>
                        <span>${isAdditional ? 'Processing Additional Review...' : 'Processing recording...'}</span>
                    </div>
                `;
            }
            
            // Stop visualization
            this.stopVisualization();
            
            // Stop timer but keep timer display visible
            this.stopRecordingTimer();
            
            return new Promise(resolve => {
                this.mediaRecorder.addEventListener('stop', async () => {
                    try {
                        // Get recording blob
                        const audioBlob = new Blob(this.audioChunks, { type: this.getOutputMimeType() });
                        
                        // Stop all tracks in the media stream
                        if (this.mediaStream) {
                            this.mediaStream.getTracks().forEach(track => track.stop());
                        }
                        
                        // Display audio preview without waiting for MP3 conversion
                        this.displayAudioPreview(audioBlob);
                        
                        // Process the recording
                        await this.processRecording(audioBlob);
                        
                        // Update processing status
                        this.updateProcessingStatus('transcription', 'done');
                        this.updateProcessingStatus('analysis', 'done');
                        
                        // Hide transcription status if in additional mode
                        if (isAdditional) {
                            const transcriptionStatus = document.getElementById('additional-transcription-status');
                            if (transcriptionStatus) {
                                transcriptionStatus.classList.add('hidden');
                            }
                        }
                        
                        resolve();
                    } catch (error) {
                        this.log.error('Error in stop recording handler:', error);
                        
                        // Hide transcription status if in additional mode
                        if (isAdditional) {
                            const transcriptionStatus = document.getElementById('additional-transcription-status');
                            if (transcriptionStatus) {
                                transcriptionStatus.classList.add('hidden');
                            }
                        }
                        
                        throw error;
                    } finally {
                        // Always reset the recording state when done
                        this.resetRecordingState();
                    }
                });
                
                this.mediaRecorder.stop();
            });
        } catch (error) {
            this.log.error('Error stopping recording:', error);
            
            // Reset state on error
            this.resetRecordingState();
            
            throw error;
        }
    }

    /**
     * Start a timer for recording duration - enhanced to work consistently across all scenarios
     * @param {HTMLElement} timerElement - Element to show timer in
     */
    startRecordingTimer(timerElement) {
        // Always update both main and additional counters for robustness
        const mainTimer = document.getElementById('recording-time');
        const additionalTimer = document.getElementById('additional-recording-time');
        this.recordingStartTime = Date.now();

        // Clear any existing timer
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }

        this.recordingTimer = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
            const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
            const formattedTime = `${minutes}:${seconds}`;

            // Update all available timers for consistency
            const allTimers = [
                mainTimer,
                additionalTimer,
                document.getElementById('timer')
            ];
            
            allTimers.forEach(timer => {
                if (timer) {
                    // Update timer text
                    timer.textContent = formattedTime;
                    timer.classList.remove('hidden');
                    
                    // Update progress ring if present
                    const timerCircle = timer.closest('.timer-circle');
                    if (timerCircle) {
                        const progressRing = timerCircle.querySelector('.timer-ring-progress');
                        if (progressRing) {
                            // Calculate progress (5 minutes = 300 seconds)
                            const maxDuration = 300;
                            const progress = Math.min(elapsedSeconds / maxDuration, 1);
                            const circumference = 289; // 2 * PI * 46
                            const offset = circumference - (progress * circumference);
                            progressRing.style.strokeDashoffset = offset;
                        }
                        
                        // Add warning state when approaching max duration (4+ minutes)
                        if (elapsedSeconds >= 240) {
                            timerCircle.classList.add('warning');
                        } else {
                            timerCircle.classList.remove('warning');
                        }
                    } else {
                        // Fallback for old-style timers
                        if (elapsedSeconds >= 240) {
                            timer.classList.add('text-red-600');
                            timer.classList.add('font-bold');
                        } else {
                            timer.classList.remove('text-red-600');
                            timer.classList.remove('font-bold');
                        }
                    }
                }
            });
            
            // Update circular timer pulsating effect if present
            const circularTimer = document.getElementById('timer');
            if (circularTimer) {
                const pulsateElement = circularTimer.parentElement.querySelector('.timer-pulse');
                if (pulsateElement) {
                    pulsateElement.classList.remove('hidden');
                }
            }
        }, 1000);
    }

    /**
     * Stop the recording timer - fixed to work consistently
     */
    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        // Hide and reset all timer elements
        const timerElements = [
            document.getElementById('recording-time'),
            document.getElementById('additional-recording-time')
        ];
        timerElements.forEach(element => {
            if (element) {
                element.classList.add('hidden');
                element.textContent = '00:00';
            }
        });
        const circularTimer = document.getElementById('timer');
        if (circularTimer) {
            // Reset timer display
            circularTimer.textContent = '00:00';
            
            // Reset progress ring
            const timerCircle = circularTimer.closest('.timer-circle');
            if (timerCircle) {
                const progressRing = timerCircle.querySelector('.timer-ring-progress');
                if (progressRing) {
                    progressRing.style.strokeDashoffset = 289;
                }
                timerCircle.classList.remove('warning');
            }
            
            // Hide pulse effect (legacy)
            const pulsateElement = circularTimer.parentElement.querySelector('.timer-pulse');
            if (pulsateElement) {
                pulsateElement.classList.add('hidden');
            }
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
                this.audioContext = new (window.AudioContext || window.webkit.AudioContext)();
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
            this.log.error('Error setting up visualization:', error);
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
     * Gets the best output MIME type based on recorded format
     * @returns {string} - MIME type for output blob
     */
    getOutputMimeType() {
        // If we're using a specific recording MIME type, use that
        if (this.recordingSettings.mimeType) {
            return this.recordingSettings.mimeType;
        }
        
        // Default fallback
        return 'audio/webm';
    }

    /**
     * Convert audio to MP3 format with improved mobile compatibility and error handling
     * @param {Blob} audioBlob - Audio blob from recorder
     * @returns {Promise<Blob>} - MP3 audio blob or original blob if conversion fails
     */
    async convertToMP3(audioBlob) {
        try {
            // Initial checks
            this.log.debug('Starting MP3 conversion, audio type:', audioBlob.type);
            
            // If we already have MP3, just return it
            if (audioBlob.type === 'audio/mpeg' || audioBlob.type === 'audio/mp3') {
                this.log.debug('Audio already in MP3 format, skipping conversion');
                return audioBlob;
            }
            
            // For iOS Safari, we need a simpler approach since it may not support certain Web APIs
            if (this.isIOSSafari()) {
                this.log.debug('Using simplified MP3 conversion for iOS Safari');
                return await this.simpleMP3Conversion(audioBlob);
            }
            
            // Standard approach using Web Audio API
            return await new Promise((resolve, reject) => {
                const fileReader = new FileReader();
                
                fileReader.onload = async (event) => {
                    try {
                        // Create audio context
                        const AudioContext = window.AudioContext || window.webkit.AudioContext;
                        const audioContext = new AudioContext();
                        
                        // Check if data is valid
                        const arrayBuffer = event.target.result;
                        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                            this.log.error('Invalid audio data: empty buffer');
                            // Try the simple method as fallback
                            const fallbackResult = await this.simpleMP3Conversion(audioBlob);
                            resolve(fallbackResult);
                            return;
                        }
                        
                        // Decode the audio data with robust error handling
                        let audioBuffer;
                        try {
                            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                            
                            // Validate the audio buffer
                            if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.duration === 0) {
                                throw new Error('Decoded audio buffer is invalid');
                            }
                            
                        } catch (decodeError) {
                            this.log.warn('Audio decoding failed, trying alternative approach:', decodeError.message);
                            
                            // Try direct WebM to Opus conversion (Whisper can handle Opus)
                            try {
                                const opusBlob = await this.webmToOpus(audioBlob);
                                if (opusBlob && opusBlob.size > 0) {
                                    this.log.debug(`Converted to Opus format: ${opusBlob.size} bytes`);
                                    resolve(opusBlob);
                                    return;
                                }
                            } catch (opusError) {
                                this.log.warn('Opus conversion failed:', opusError);
                            }
                            
                            // Then try with audio element as another fallback
                            try {
                                audioBuffer = await this.decodeAudioUsingElement(audioBlob);
                            } catch (elementError) {
                                this.log.error('All decoding approaches failed:', elementError);
                                // Try the simple conversion as a last resort
                                const simpleResult = await this.simpleMP3Conversion(audioBlob);
                                resolve(simpleResult);
                                return;
                            }
                        }
                        
                        // Process the audio buffer to create a proper MP3 blob
                        try {
                            // Create a media stream from the audio buffer for re-encoding
                            const destination = audioContext.createMediaStreamDestination();
                            const source = audioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(destination);
                            
                            // Start the source
                            source.start(0);
                            
                            // Create a recorder with MP3 type if supported
                            const recorderOptions = {};
                            if (MediaRecorder.isTypeSupported('audio/mpeg')) {
                                recorderOptions.mimeType = 'audio/mpeg';
                            } else if (MediaRecorder.isTypeSupported('audio/mp3')) {
                                recorderOptions.mimeType = 'audio/mp3';
                            }
                            
                            const recorder = new MediaRecorder(destination.stream, recorderOptions);
                            const chunks = [];
                            
                            recorder.ondataavailable = e => {
                                if (e.data.size > 0) {
                                    chunks.push(e.data);
                                }
                            };
                            
                            recorder.onstop = () => {
                                // Create output blob - ensure it's named as MP3 for Whisper API
                                const outputBlob = new Blob(chunks, { type: 'audio/mp3' });
                                
                                // Validate the output
                                if (outputBlob.size === 0) {
                                    this.log.warn('Conversion produced an empty blob, using original as fallback');
                                    resolve(audioBlob);
                                    return;
                                }
                                
                                this.log.debug(`MP3 conversion complete: ${outputBlob.size} bytes, type: ${outputBlob.type}`);
                                resolve(outputBlob);
                            };
                            
                            // Record for the duration of the audio buffer
                            recorder.start();
                            
                            // Stop after the buffer's duration plus a small margin
                            setTimeout(() => {
                                try {
                                    if (recorder.state === 'recording') {
                                        recorder.stop();
                                    }
                                } catch (stopError) {
                                    this.log.warn('Error stopping recorder:', stopError);
                                    resolve(audioBlob); // Fallback to original
                                }
                            }, (audioBuffer.duration * 1000) + 500);
                            
                        } catch (processingError) {
                            this.log.error('Error processing audio buffer:', processingError);
                            // Return a specially marked blob to indicate the need for server-side processing
                            resolve(new Blob([arrayBuffer], { 
                                type: 'audio/wav'  // Use WAV as a more universal format
                            }));
                        }
                        
                    } catch (err) {
                        this.log.error('Error in MP3 conversion:', err);
                        // Simple fallback conversion
                        try {
                            const simpleResult = await this.simpleMP3Conversion(audioBlob);
                            resolve(simpleResult);
                        } catch (fallbackError) {
                            this.log.error('Simple conversion failed too:', fallbackError);
                            // Last resort: return original with MP3 mime type for better API compatibility
                            const repackagedBlob = new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
                            resolve(repackagedBlob);
                        }
                    }
                };
                
                fileReader.onerror = async (error) => {
                    this.log.error('FileReader error during MP3 conversion:', error);
                    try {
                        // Try simple conversion as fallback
                        const simpleResult = await this.simpleMP3Conversion(audioBlob);
                        resolve(simpleResult);
                    } catch (fallbackError) {
                        this.log.error('Simple conversion failed too:', fallbackError);
                        resolve(audioBlob); // Ultimate fallback to original
                    }
                };
                
                fileReader.readAsArrayBuffer(audioBlob);
            });
        } catch (err) {
            this.log.error('Exception in convertToMP3:', err);
            return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
        }
    }

    /**
     * Convert WebM audio to Opus format which Whisper API can handle better
     * @param {Blob} webmBlob - WebM audio blob
     * @returns {Promise<Blob>} - Opus audio blob
     */
    async webmToOpus(webmBlob) {
        return new Promise((resolve, reject) => {
            try {
                // Create audio element to play the WebM audio
                const audio = new Audio();
                const webmUrl = URL.createObjectURL(webmBlob);
                audio.src = webmUrl;
                
                // When audio metadata is loaded, we can access its properties
                audio.onloadedmetadata = async () => {
                    try {
                        // Get audio duration
                        const duration = audio.duration;
                        if (!isFinite(duration) || duration <= 0) {
                            throw new Error('Invalid audio duration');
                        }
                        
                        // Create a new audio context
                        const AudioContext = window.AudioContext || window.webkit.AudioContext;
                        const context = new AudioContext();
                        
                        // Create a media stream from the audio element
                        const mediaStream = audio.captureStream ? audio.captureStream() : 
                                           audio.mozCaptureStream ? audio.mozCaptureStream() : null;
                                           
                        if (!mediaStream) {
                            throw new Error('Browser does not support captureStream');
                        }
                        
                        // Create a MediaRecorder with Opus format
                        const recOptions = {};
                        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                            recOptions.mimeType = 'audio/webm;codecs=opus';
                        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                            recOptions.mimeType = 'audio/ogg;codecs=opus';
                        }
                        
                        const recorder = new MediaRecorder(mediaStream, recOptions);
                        const chunks = [];
                        
                        recorder.ondataavailable = e => {
                            if (e.data.size > 0) {
                                chunks.push(e.data);
                            }
                        };
                        
                        recorder.onstop = () => {
                            URL.revokeObjectURL(webmUrl);
                            const opusBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/ogg' });
                            resolve(opusBlob);
                        };
                        
                        // Start recording and playback
                        recorder.start();
                        audio.play();
                        
                        // Stop recording when playback ends
                        audio.onended = () => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                            }
                        };
                        
                        // Set a timeout as fallback
                        setTimeout(() => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                            }
                        }, (duration * 1000) + 2000); // Add 2 seconds buffer
                        
                    } catch (error) {
                        URL.revokeObjectURL(webmUrl);
                        reject(error);
                    }
                };
                
                audio.onerror = (error) => {
                    URL.revokeObjectURL(webmUrl);
                    reject(new Error(`Audio loading error: ${error.message || 'unknown error'}`));
                };
                
                // Start loading
                audio.load();
                
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Simplified MP3 conversion for iOS Safari and other limited browsers
     * @param {Blob} audioBlob - Original audio blob
     * @returns {Promise<Blob>} - Processed audio blob
     */
    async simpleMP3Conversion(audioBlob) {
        try {
            this.log.debug('Starting simple conversion process');
            
            // Create a new blob with MP3 MIME type for better compatibility with Whisper API
            // This isn't actually converting the format, just changing the content type
            const processedBlob = new Blob([await audioBlob.arrayBuffer()], { 
                type: 'audio/mp3'  // Whisper API expects this MIME type
            });
            
            if (processedBlob.size === 0) {
                throw new Error('Conversion resulted in empty blob');
            }
            
            this.log.debug(`Simple conversion complete: ${processedBlob.size} bytes, type: ${processedBlob.type}`);
            return processedBlob;
        } catch (err) {
            this.log.error('Error in simple MP3 conversion:', err);
            // Last resort: return the original blob but with MP3 MIME type
            return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
        }
    }

    /**
     * Transcribe audio using backend API V3.
     * Uses ApiService which calls /api/v3/ai/orchestrate.
     * @param {Blob} audioBlob - Audio blob from recorder
     * @returns {Promise<Object>} - Enhanced result with text + concepts
     */
    async transcribeAudio(audioBlob) {
        this.log.debug('Transcribing audio via API V3 (orchestrate with concepts)...');
        
        // Check if ApiService is available
        if (!window.ApiService) {
            throw new Error('ApiService not initialized');
        }

        // Check authentication
        if (!window.AuthService || !window.AuthService.isAuthenticated()) {
            throw new Error('Authentication required for transcription');
        }

        try {
            // ✅ USE ORCHESTRATE: Single API call returns both transcription + concepts
            const result = await window.ApiService.transcribeAudio(audioBlob, 'en');
            
            // API V3 returns Pydantic model: 
            // { workflow: str, results: {...}, saved_to_db: bool, processing_time_ms: int }
            // For audio_only: results = { transcription: {...}, concepts: {...} }
            if (!result || !result.results || !result.results.transcription || !result.results.transcription.text) {
                this.log.error('Invalid API response structure:', result);
                throw new Error('Invalid response from transcription API');
            }
            
            this.log.debug('✅ Transcription + concepts successful via API V3 orchestrate');
            
            // ✅ Return enhanced result with both transcription AND concepts
            return {
                text: result.results.transcription.text,
                transcription: result.results.transcription,
                concepts: result.results.concepts  // ✅ Concepts already extracted!
            };
            
        } catch (error) {
            this.log.error('Transcription error:', error);
            throw new Error(`Transcription failed: ${error.message}`);
        }
    }

    /**
     * Process a finished recording (standard or additional), convert to MP3/Opus, and send to Whisper.
     * @param {Blob} audioBlob - Raw recording blob from MediaRecorder
     * @param {number} pendingAudioId - ID of pending audio record (for retries)
     */
    async processRecording(audioBlob, pendingAudioId = null) {
        let audioId = pendingAudioId;
        
        try {
            this.log.debug('Processing recording, original format:', audioBlob.type);
            
            // Save audio to IndexedDB first if not already saved
            if (!audioId && window.PendingAudioManager) {
                // Get current draft ID if exists
                let draftId = null;
                if (window.DraftRestaurantManager && window.DraftRestaurantManager.currentDraftId) {
                    draftId = window.DraftRestaurantManager.currentDraftId;
                } else if (this.uiManager && this.uiManager.currentCurator) {
                    // Create or get draft for current curator
                    if (window.DraftRestaurantManager) {
                        draftId = await window.DraftRestaurantManager.getOrCreateCurrentDraft(
                            this.uiManager.currentCurator.id
                        );
                    }
                }
                
                audioId = await window.PendingAudioManager.saveAudio(audioBlob, {
                    isAdditional: this.isAdditionalRecording,
                    restaurantId: this.uiManager?.editingRestaurantId || null,
                    draftId: draftId
                });
                
                // Update draft to indicate it has audio
                if (draftId && window.DraftRestaurantManager) {
                    await window.DraftRestaurantManager.updateDraft(draftId, { hasAudio: true });
                }
                
                this.log.debug(`Audio saved to IndexedDB with ID: ${audioId}`);
            }
            
            // Update status to processing
            if (audioId && window.PendingAudioManager) {
                await window.PendingAudioManager.updateAudio(audioId, { status: 'processing' });
            }
            
            // Send webm directly - OpenAI Whisper supports webm natively
            // Fake MP3 conversion was causing "corrupted" errors
            const transcription = await this.transcribeAudio(audioBlob);
            
            // ✅ transcription is now an object: { text, transcription, concepts }
            this.processTranscription(transcription);

            // Signal main transcription done
            this.updateProcessingStatus('transcription', 'done');

            // ALSO clear any "additional review" status indicator
            this.updateProcessingStatus('analysis', 'done');
            
            // Mark audio as completed in IndexedDB
            if (audioId && window.PendingAudioManager) {
                await window.PendingAudioManager.updateAudio(audioId, { 
                    status: 'completed',
                    completedAt: new Date()
                });
                this.log.debug(`Audio ${audioId} marked as completed`);
            }
            
            // Reset recording tool state after successful transcription
            this.resetRecordingToolState();
            // Validate audio blob before processing
            if (!audioBlob || audioBlob.size === 0) {
                this.log.error('Invalid audio blob: empty or null');
                this.updateProcessingStatus('transcription', 'error');
                throw new Error('Recording failed: No audio data captured');
            }
            
            this.log.debug(`Processing audio blob: type=${audioBlob.type}, size=${audioBlob.size} bytes`);
            
        } catch (error) {
            this.log.error('Error processing recording:', error);
            this.updateProcessingStatus('transcription', 'error');
            
            // Handle retry logic
            if (audioId && window.PendingAudioManager) {
                const retryCount = await window.PendingAudioManager.incrementRetryCount(audioId, error.message);
                this.log.debug(`Transcription failed. Retry count: ${retryCount}`);
                
                const canRetry = await window.PendingAudioManager.canAutoRetry(audioId);
                if (canRetry) {
                    // Schedule automatic retry
                    this.log.debug('Scheduling automatic retry...');
                    await window.PendingAudioManager.scheduleAutoRetry(audioId, async (retryAudioId, retryAudio) => {
                        this.log.debug(`Retrying transcription for audio ${retryAudioId}`);
                        await this.processRecording(retryAudio.audioBlob, retryAudioId);
                    });
                    
                    // Notify user about retry
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        window.uiUtils.showNotification(
                            `Transcription failed. Retrying automatically (attempt ${retryCount + 1} of ${window.PendingAudioManager.maxAutoRetries})...`, 
                            'warning'
                        );
                    }
                } else {
                    // Max retries reached, show manual retry option
                    this.log.debug('Max auto-retries reached. Manual retry required.');
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        window.uiUtils.showNotification(
                            `Transcription failed after ${retryCount} attempts. Please try again manually.`, 
                            'error'
                        );
                    }
                    
                    // Show manual retry UI
                    this.showManualRetryUI(audioId);
                }
            } else {
                // No audio manager available, just show error
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(`Error transcribing audio: ${error.message}`, 'error');
                }
            }
            
            // Still reset recording tool state on error
            this.resetRecordingToolState();
            throw error;
        }
    }

    /**
     * Process transcription results with improved handling for all recording scenarios
     * Now also handles concepts if returned by orchestrate endpoint
     * Always appends to the textarea instead of replacing it.
     */
    processTranscription(result) {
        try {
            // ✅ HANDLE ORCHESTRATE RESPONSE: result may contain { text, transcription, concepts }
            let transcription;
            let concepts = null;
            
            // 🔍 DEBUG: Log what we received from API
            this.log.debug('📄 API Response received:', {
                type: typeof result,
                hasText: !!result?.text,
                hasTranscription: !!result?.transcription,
                hasConcepts: !!result?.concepts,
                conceptsType: typeof result?.concepts,
                conceptsKeys: result?.concepts ? Object.keys(result.concepts) : 'N/A',
                fullStructure: JSON.stringify(result, null, 2)
            });
            
            if (typeof result === 'object' && result.text) {
                // Enhanced format from orchestrate: { text, transcription, concepts }
                transcription = result.text;
                concepts = result.concepts;
                this.log.debug(`✅ Received orchestrate response with ${concepts?.concepts?.length || 0} concepts`);
                this.log.debug('📄 Concepts structure:', JSON.stringify(concepts, null, 2));
            } else if (typeof result === 'object' && result.transcription) {
                // Alternative format
                transcription = result.transcription.text || result.transcription;
                concepts = result.concepts;
                this.log.debug('✅ Received orchestrate response with concepts:', !!concepts);
            } else if (typeof result === 'string') {
                // Plain string (legacy)
                transcription = result;
            } else {
                this.log.warn('Empty or invalid transcription received');
                return;
            }
            
            if (!transcription || transcription.trim() === '') {
                this.log.warn('Empty transcription text');
                return;
            }
            
            this.log.debug('Processing transcription, length:', transcription.length);
            
            // Check if this is an additional recording
            const isAdditional = this.isAdditionalRecording;
            
            // Get the transcription textarea
            const textarea = document.getElementById('restaurant-transcription');
            if (!textarea) {
                this.log.error('Transcription textarea not found');
                return;
            }
            
            // Update the textarea content
            if (isAdditional) {
                // For additional recordings, delegate to the conceptModule
                if (this.uiManager && this.uiManager.conceptModule && 
                    typeof this.uiManager.conceptModule.handleAdditionalRecordingComplete === 'function') {
                    this.uiManager.conceptModule.handleAdditionalRecordingComplete(transcription);
                } else {
                    // Fallback: append with a separator
                    const prev = textarea.value.trim();
                    // Create formatted timestamp
                    const timestamp = new Date().toLocaleString();
                    // Format the text with timestamp
                    textarea.value = prev ? `${prev}\n\n--- Additional Review (${timestamp}) ---\n${transcription}` : transcription;
                    textarea.dispatchEvent(new Event('input'));
                }
            } else {
                // For new recordings, update textarea and process concepts
                textarea.value = transcription;
                textarea.dispatchEvent(new Event('input'));
                
                // ✅ Trigger concept processing (will use pre-extracted concepts if available)
                this.triggerConceptProcessing(transcription, concepts?.concepts);
            }
            
            this.log.debug('Transcription processing completed successfully');
            
            // Reset recording tool state after successful transcription
            setTimeout(() => {
                this.resetRecordingToolState();
            }, 100); // Small delay to ensure other processes finish
            
        } catch (error) {
            this.log.error('Error processing transcription:', error);
            
            // Still reset recording tool state on error
            setTimeout(() => {
                this.resetRecordingToolState();
            }, 100);
        }
    }

    /**
     * Trigger concept processing pipeline after a successful transcription
     * ✅ NOW ACCEPTS PRE-EXTRACTED CONCEPTS to skip second API call
     * @param {string} transcription - The transcribed text
     * @param {Array} preExtractedConcepts - Optional concepts already extracted by orchestrate
     */
    triggerConceptProcessing(transcription, preExtractedConcepts = null) {
        try {
            this.log.debug('🔵 Triggering concept processing for new restaurant');
            
            // 🔍 DEBUG: Log preExtractedConcepts in detail
            this.log.debug('📄 preExtractedConcepts received:', {
                exists: !!preExtractedConcepts,
                type: typeof preExtractedConcepts,
                isArray: Array.isArray(preExtractedConcepts),
                length: Array.isArray(preExtractedConcepts) ? preExtractedConcepts.length : 'N/A',
                structure: JSON.stringify(preExtractedConcepts, null, 2)
            });
            
            // ✅ IF CONCEPTS PRE-EXTRACTED: Apply them directly
            if (preExtractedConcepts && Array.isArray(preExtractedConcepts) && preExtractedConcepts.length > 0) {
                this.log.debug(`✅ Using ${preExtractedConcepts.length} pre-extracted concepts from orchestrate`);
                
                // Method 1: Use conceptModule with direct concept application
                if (this.uiManager && this.uiManager.conceptModule) {
                    if (typeof this.uiManager.conceptModule.displayConcepts === 'function') {
                        this.uiManager.conceptModule.displayConcepts(preExtractedConcepts);
                        return;
                    }
                }
                
                // Method 2: Use global conceptModule
                if (window.conceptModule && typeof window.conceptModule.displayConcepts === 'function') {
                    window.conceptModule.displayConcepts(preExtractedConcepts);
                    return;
                }
                
                this.log.warn('No method to apply pre-extracted concepts, falling back to standard processing');
            }
            
            // FALLBACK: Standard concept extraction (will make another API call)
            this.log.debug('Using standard concept processing (will call extractConcepts API)');
            
            // Method 1: Use conceptModule directly if available
            if (this.uiManager && this.uiManager.conceptModule && 
                typeof this.uiManager.conceptModule.processConcepts === 'function') {
                this.log.debug('Using uiManager.conceptModule.processConcepts');
                this.uiManager.conceptModule.processConcepts(transcription);
                return;
            }
            
            // Method 2: Find globally available conceptModule
            if (window.conceptModule && typeof window.conceptModule.processConcepts === 'function') {
                this.log.debug('Using global conceptModule.processConcepts');
                window.conceptModule.processConcepts(transcription);
                return;
            }
            
            // Method 3: Use the reprocessConcepts function if available
            const reprocessButton = document.getElementById('reprocess-concepts');
            if (reprocessButton) {
                this.log.debug('Using reprocess-concepts button click as fallback');
                reprocessButton.click();
                return;
            }
            
            // Method 4: Notify the user that manual processing is needed
            this.log.warn('No automatic concept processing available, user needs to click "Reprocess Concepts" manually');
            this.showProcessingNotification();
        } catch (error) {
            this.log.error('Error triggering concept processing:', error);
        }
    }

    /**
     * Completely reset the recording tool state after processing is done
     * This ensures the recorder is ready for the next recording
     */
    resetRecordingToolState() {
        this.log.debug('Resetting recording tool state');
        
        // Reset all state flags
        this.isRecording = false;
        this.isAdditionalRecording = false;
        
        // Release media resources
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(track => track.stop());
            } catch (e) {
                this.log.warn('Error stopping media tracks:', e);
            }
            this.mediaStream = null;
        }
        
        // Clear recorder and chunks
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        // Stop visualization and timer
        this.stopVisualization();
        this.stopRecordingTimer();
        
        // Reset uiManager state if available
        if (this.uiManager) {
            this.uiManager.isRecordingAdditional = false;
        }
        
        // Update UI - show start buttons, hide stop buttons
        this.updateRecordingUI(false, false);
    }
    
    /**
     * Update all recording UI elements to reflect current state
     * @param {boolean} isRecording - Whether recording is active
     * @param {boolean} isAdditional - Whether this is an additional recording
     */
    updateRecordingUI(isRecording, isAdditional) {
        // Main recording controls
        const startBtn = document.getElementById('start-record');
        const stopBtn = document.getElementById('stop-record');
        const recordingTime = document.getElementById('recording-time');
        const audioVisualizer = document.getElementById('audio-visualizer');
        const recordingStatus = document.getElementById('recording-status');
        
        // Additional recording controls
        const additionalStartBtn = document.getElementById('additional-record-start');
        const additionalStopBtn = document.getElementById('additional-record-stop');
        const additionalRecordingTime = document.getElementById('additional-recording-time');
        const additionalAudioVisualizer = document.getElementById('additional-audio-visualizer');
        const additionalRecordingStatus = document.getElementById('additional-recording-status');
        
        // Update main controls
        if (startBtn) startBtn.classList.toggle('hidden', isRecording);
        if (stopBtn) stopBtn.classList.toggle('hidden', !isRecording);
        if (recordingTime) recordingTime.classList.toggle('hidden', !isRecording);
        if (audioVisualizer) audioVisualizer.classList.add('hidden');
        if (recordingStatus) recordingStatus.textContent = '';
        
        // Update additional controls
        if (additionalStartBtn) additionalStartBtn.classList.toggle('hidden', isRecording && isAdditional);
        if (additionalStopBtn) additionalStopBtn.classList.toggle('hidden', !(isRecording && isAdditional));
        if (additionalRecordingTime) additionalRecordingTime.classList.add('hidden');
        if (additionalAudioVisualizer) additionalAudioVisualizer.classList.add('hidden');
        if (additionalRecordingStatus) additionalRecordingStatus.textContent = '';
    }
    
    /**
     * Apply pre-extracted concepts directly to the form
     * @param {Array} concepts - Array of concept objects from orchestrate
     */
    applyConcepts(concepts) {
        try {
            this.log.debug(`Applying ${concepts.length} pre-extracted concepts`);
            
            // Method 1: Use conceptModule if available
            if (this.uiManager && this.uiManager.conceptModule && 
                typeof this.uiManager.conceptModule.applyConcepts === 'function') {
                this.uiManager.conceptModule.applyConcepts(concepts);
                return;
            }
            
            // Method 2: Use global conceptModule
            if (window.conceptModule && typeof window.conceptModule.applyConcepts === 'function') {
                window.conceptModule.applyConcepts(concepts);
                return;
            }
            
            // Method 3: Populate form fields directly (fallback)
            this.populateConceptFields(concepts);
            
        } catch (error) {
            this.log.error('Error applying concepts:', error);
        }
    }
    
    /**
     * Populate form fields directly from concepts (fallback method)
     * @param {Array} concepts - Array of concept objects
     */
    populateConceptFields(concepts) {
        try {
            const fieldMapping = {
                'name': 'restaurant-name',
                'cuisine': 'restaurant-cuisine',
                'price_range': 'restaurant-price',
                'address': 'restaurant-address',
                'city': 'restaurant-city',
                'neighborhood': 'restaurant-neighborhood',
                'phone': 'restaurant-phone',
                'website': 'restaurant-website'
            };
            
            for (const concept of concepts) {
                const fieldId = fieldMapping[concept.category];
                if (fieldId) {
                    const field = document.getElementById(fieldId);
                    if (field && concept.value) {
                        field.value = concept.value;
                        field.dispatchEvent(new Event('input'));
                        this.log.debug(`✅ Populated ${concept.category}: ${concept.value}`);
                    }
                }
            }
        } catch (error) {
            this.log.error('Error populating concept fields:', error);
        }
    }
    
    /**
     * Trigger concept processing pipeline after a successful transcription
     * @param {string} transcription - The transcribed text
     * @param {object} preExtractedConcepts - Optional pre-extracted concepts from orchestrate API
     */
    async triggerConceptProcessing(transcription, preExtractedConcepts = null) {
        try {
            this.log.debug('Triggering concept processing for new restaurant');
            this.log.debug('Pre-extracted concepts available:', !!preExtractedConcepts);
            
            // Method 1: Use conceptModule directly if available
            if (this.uiManager && this.uiManager.conceptModule && 
                typeof this.uiManager.conceptModule.processConcepts === 'function') {
                this.log.debug('Using uiManager.conceptModule.processConcepts');
                
                // Pass pre-extracted concepts if available to avoid redundant API call
                if (preExtractedConcepts) {
                    this.log.debug('Using pre-extracted concepts from orchestrate');
                    try {
                        await this.uiManager.conceptModule.processPreExtractedConcepts(transcription, preExtractedConcepts);
                        console.log('=== PRE-EXTRACTED: Completed successfully, returning ===');
                        return;
                    } catch (error) {
                        this.log.error('Error in processPreExtractedConcepts:', error);
                        SafetyUtils.showNotification('Error processing concepts', 'error');
                        return; // CRITICAL: Still return even on error
                    }
                } else {
                    this.log.debug('No pre-extracted concepts, will make separate API call');
                    try {
                        await this.uiManager.conceptModule.processConcepts(transcription);
                        console.log('=== PROCESS: Completed successfully, returning ===');
                        return;
                    } catch (error) {
                        this.log.error('Error in processConcepts:', error);
                        SafetyUtils.showNotification('Error processing concepts', 'error');
                        return;
                    }
                }
            }
            
            // Method 2: Find globally available conceptModule
            if (window.conceptModule && typeof window.conceptModule.processConcepts === 'function') {
                this.log.debug('Using global conceptModule.processConcepts');
                window.conceptModule.processConcepts(transcription);
                return;
            }
            
            // Method 3: Use the reprocessConcepts function if available
            const reprocessButton = document.getElementById('reprocess-concepts');
            if (reprocessButton) {
                this.log.debug('Using reprocess-concepts button click as fallback');
                reprocessButton.click();
                return;
            }
            
            // Method 4: Notify the user that manual processing is needed
            this.log.warn('No automatic concept processing available, user needs to click "Reprocess Concepts" manually');
            this.showProcessingNotification();
        } catch (error) {
            this.log.error('Error triggering concept processing:', error);
        }
    }
    
    /**
     * Shows a notification about processing next steps
     */
    showProcessingNotification() {
        try {
            // Try using uiUtils notification
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(
                    'Transcription complete. Click "Reprocess Concepts" to extract restaurant details.', 
                    'info'
                );
                return;
            }
            
            // Try using uiManager notification
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                this.uiManager.showNotification(
                    'Transcription complete. Click "Reprocess Concepts" to extract restaurant details.', 
                    'info'
                );
                return;
            }
            
            // Fallback: Create an inline notification
            const transcriptionArea = document.getElementById('restaurant-transcription');
            if (transcriptionArea && transcriptionArea.parentNode) {
                const notificationDiv = document.createElement('div');
                notificationDiv.className = 'p-2 mt-2 bg-blue-50 text-blue-800 rounded border border-blue-200';
                notificationDiv.innerHTML = `
                    <div class="flex items-center">
                        <span class="material-icons text-blue-500 mr-2">info</span>
                        <span>Transcription complete. Click "Reprocess Concepts" to extract restaurant details.</span>
                    </div>
                `;
                
                // Add after transcription area
                transcriptionArea.parentNode.insertBefore(notificationDiv, transcriptionArea.nextSibling);
                
                // Auto-remove after 10 seconds
                setTimeout(() => {
                    if (notificationDiv.parentNode) {
                        notificationDiv.parentNode.removeChild(notificationDiv);
                    }
                }, 10000);
            }
        } catch (error) {
            this.log.error('Error showing processing notification:', error);
        }
    }

    /**
     * Checks if browser is iOS Safari which requires special handling
     * @returns {boolean} - True if browser is iOS Safari
     */
    isIOSSafari() {
        const userAgent = navigator.userAgent;
        return /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream && /Safari/.test(userAgent);
    }
    
    /**
     * Sets up event delegation for recording buttons
     * This allows handling clicks even if buttons are added after initialization
     */
    setupEventDelegation() {
        // Only set up delegation once
        if (this.eventDelegationSetup) return;
        this.eventDelegationSetup = true;
        
        this.log.debug('Setting up event delegation for recording buttons');
        
        document.addEventListener('click', async (event) => {
            // Handle start recording button
            if (event.target.id === 'start-record' || 
                (event.target.parentElement && event.target.parentElement.id === 'start-record')) {
                this.log.debug('Start recording clicked via delegation');
                try {
                    await this.startRecording();
                } catch (error) {
                    this.log.error('Error starting recording via delegation:', error);
                }
            }
            
            // Handle stop recording button
            if (event.target.id === 'stop-record' || 
                (event.target.parentElement && event.target.parentElement.id === 'stop-record')) {
                this.log.debug('Stop recording clicked via delegation');
                try {
                    await this.stopRecording();
                } catch (error) {
                    this.log.error('Error stopping recording via delegation:', error);
                }
            }
            
            // Handle additional record start button
            if (event.target.id === 'additional-record-start' || 
                (event.target.parentElement && event.target.parentElement.id === 'additional-record-start')) {
                this.log.debug('Additional record start clicked via delegation');
                try {
                    // Set the additional recording flag
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = true;
                    }
                    await this.startRecording();
                } catch (error) {
                    this.log.error('Error starting additional recording via delegation:', error);
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
                    }
                }
            }
            
            // Handle additional record stop button
            if (event.target.id === 'additional-record-stop' || 
                (event.target.parentElement && event.target.parentElement.id === 'additional-record-stop')) {
                this.log.debug('Additional record stop clicked via delegation');
                try {
                    await this.stopRecording();
                } catch (error) {
                    this.log.error('Error stopping additional recording via delegation:', error);
                } finally {
                    // Ensure flag is reset
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
                    }
                }
            }
        });
        
        this.log.debug('Event delegation for recording buttons completed');
    }
    
    /**
     * Display audio preview with controls - Implementation of the missing function
     * @param {Blob} audioBlob - The recorded audio blob
     */
    displayAudioPreview(audioBlob) {
        try {
            // Determine if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            
            // Get the appropriate preview element
            const audioPreviewContainer = document.getElementById(isAdditional ? 'additional-audio-preview' : 'audio-preview');
            if (!audioPreviewContainer) {
                this.log.warn(`Audio preview container not found for ${isAdditional ? 'additional' : 'standard'} recording`);
                return;
            }
            
            // Show the container
            audioPreviewContainer.classList.remove('hidden');
            
            // Get or create audio element
            let audioElement = audioPreviewContainer.querySelector('audio');
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = isAdditional ? 'additional-recorded-audio' : 'recorded-audio';
                audioElement.className = 'w-full mb-2';
                audioElement.controls = true;
                audioPreviewContainer.appendChild(audioElement);
            }
            
            // Set the audio source
            const audioUrl = URL.createObjectURL(audioBlob);
            audioElement.src = audioUrl;
            
            this.log.debug(`Audio preview created for ${isAdditional ? 'additional' : 'standard'} recording`);
        } catch (error) {
            this.log.error('Error displaying audio preview:', error);
        }
    }
    
    /**
     * Legacy method to maintain backward compatibility
     * @param {Blob} audioBlob - The recorded audio blob
     */
    showAudioPreview(audioBlob) {
        this.displayAudioPreview(audioBlob);
    }
    
    /**
     * Update processing status indicators
     * @param {string} type - Type of processing ('transcription' or 'analysis')
     * @param {string} status - Status ('pending', 'done', or 'error')
     */
    updateProcessingStatus(type, status) {
        try {
            // Determine if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            const statusId = isAdditional ? 
                `additional-${type}-status` : 
                `${type}-status`;
                
            const statusElement = document.getElementById(statusId);
            if (!statusElement) return;
            
            if (status === 'pending') {
                statusElement.classList.remove('hidden');
                statusElement.innerHTML = `
                    <span class="material-icons text-yellow-500 mr-1">pending</span>
                    ${type === 'transcription' ? 'Transcribing your audio...' : 'Analyzing restaurant details...'}
                `;
            } else if (status === 'done') {
                statusElement.classList.remove('hidden');
                statusElement.innerHTML = `
                    <span class="material-icons text-green-500 mr-1">check_circle</span>
                    ${type === 'transcription' ? 'Transcription complete' : 'Analysis complete'}
                `;
                
                // Hide after 3 seconds
                setTimeout(() => {
                    statusElement.classList.add('hidden');
                }, 3000);
            } else if (status === 'error') {
                statusElement.classList.remove('hidden');
                statusElement.innerHTML = `
                    <span class="material-icons text-red-500 mr-1">error</span>
                    ${type === 'transcription' ? 'Transcription failed' : 'Analysis failed'}
                `;
            }
        } catch (error) {
            this.log.error(`Error updating ${type} status:`, error);
        }
    }
    
    /**
     * Appends transcription to the existing content in case ConceptModule is not available
     * @param {string} newTranscription - The newly transcribed text to append
     */
    appendToTranscriptionField(newTranscription) {
        try {
            // Get the transcription textarea
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (!transcriptionTextarea) {
                this.log.error('Transcription textarea not found');
                return;
            }

            // Get existing content
            const existingContent = transcriptionTextarea.value || '';
            
            // Create formatted timestamp
            const timestamp = new Date().toLocaleString();
            
            // Get curator name with fallback
            let curatorName = "Unknown Curator";
            if (this.uiManager && this.uiManager.currentCurator && this.uiManager.currentCurator.name) {
                curatorName = this.uiManager.currentCurator.name;
            }
            
            // Format the combined text with a separator, curator name and timestamp
            let combinedText;
            if (existingContent && existingContent.trim() !== '') {
                // Add separator with curator name and timestamp, and the new text
                combinedText = `${existingContent}\n\n--- Additional Review by ${curatorName} (${timestamp}) ---\n${newTranscription}`;
            } else {
                // If no existing text, just use the new transcription
                combinedText = newTranscription;
            }
            
            // Update the textarea
            transcriptionTextarea.value = combinedText;
            
            // Scroll to the bottom to show the new content
            transcriptionTextarea.scrollTop = transcriptionTextarea.scrollHeight;
            
            // Highlight the textarea briefly
            transcriptionTextarea.classList.add('highlight-update');
            setTimeout(() => {
                transcriptionTextarea.classList.remove('highlight-update');
            }, 1000);
            
            this.log.debug('Additional transcription appended successfully');
        } catch (error) {
            this.log.error('Error appending transcription:', error);
        }
    }

    /**
     * Show manual retry UI for failed transcriptions
     * @param {number} audioId - Pending audio ID
     */
    showManualRetryUI(audioId) {
        try {
            // Find the recording section or transcription textarea
            const recordingSection = document.getElementById('recording-section');
            const transcriptionContainer = document.getElementById('restaurant-transcription')?.parentElement;
            const targetContainer = recordingSection || transcriptionContainer;
            
            if (!targetContainer) {
                this.log.warn('Cannot show manual retry UI - container not found');
                return;
            }
            
            // Remove existing retry UI if any
            const existingRetryUI = document.getElementById('manual-retry-ui');
            if (existingRetryUI) {
                existingRetryUI.remove();
            }
            
            // Create retry UI
            const retryUI = document.createElement('div');
            retryUI.id = 'manual-retry-ui';
            retryUI.className = 'bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4 rounded';
            retryUI.innerHTML = `
                <div class="flex items-start">
                    <div class="flex-shrink-0">
                        <span class="material-icons text-yellow-600">warning</span>
                    </div>
                    <div class="ml-3 flex-1">
                        <h3 class="text-sm font-medium text-yellow-800">Transcription Failed</h3>
                        <p class="mt-1 text-sm text-yellow-700">
                            The audio recording could not be transcribed after multiple attempts. 
                            The audio has been saved and you can retry or delete it.
                        </p>
                        <div class="mt-3 flex gap-2">
                            <button id="retry-transcription-btn" data-audio-id="${audioId}" 
                                class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded text-sm flex items-center">
                                <span class="material-icons text-sm mr-1">refresh</span>
                                Retry Transcription
                            </button>
                            <button id="delete-failed-audio-btn" data-audio-id="${audioId}"
                                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm flex items-center">
                                <span class="material-icons text-sm mr-1">delete</span>
                                Delete Audio
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // Insert at the top of the container
            targetContainer.insertBefore(retryUI, targetContainer.firstChild);
            
            // Add event listeners
            const retryBtn = retryUI.querySelector('#retry-transcription-btn');
            const deleteBtn = retryUI.querySelector('#delete-failed-audio-btn');
            
            if (retryBtn) {
                retryBtn.addEventListener('click', async () => {
                    retryBtn.disabled = true;
                    retryBtn.innerHTML = '<span class="material-icons text-sm mr-1 animate-spin">refresh</span> Retrying...';
                    
                    try {
                        const audio = await window.PendingAudioManager.getAudio(audioId);
                        if (audio && audio.audioBlob) {
                            // Reset retry count for manual retry
                            await window.PendingAudioManager.updateAudio(audioId, {
                                retryCount: 0,
                                status: 'pending',
                                lastError: null
                            });
                            
                            await this.processRecording(audio.audioBlob, audioId);
                            
                            // Remove retry UI on success
                            retryUI.remove();
                        }
                    } catch (error) {
                        this.log.error('Manual retry failed:', error);
                        retryBtn.disabled = false;
                        retryBtn.innerHTML = '<span class="material-icons text-sm mr-1">refresh</span> Retry Transcription';
                    }
                });
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    if (confirm('Are you sure you want to delete this audio recording? This action cannot be undone.')) {
                        try {
                            await window.PendingAudioManager.deleteAudio(audioId);
                            retryUI.remove();
                            
                            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                                window.uiUtils.showNotification('Audio recording deleted', 'success');
                            }
                        } catch (error) {
                            this.log.error('Error deleting audio:', error);
                            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                                window.uiUtils.showNotification('Error deleting audio', 'error');
                            }
                        }
                    }
                });
            }
            
        } catch (error) {
            this.log.error('Error showing manual retry UI:', error);
        }
    }

    /**
     * Show pending audio indicator badge
     * @param {number} count - Number of pending audios
     */
    async showPendingAudioBadge() {
        try {
            if (!window.PendingAudioManager) return;
            
            const counts = await window.PendingAudioManager.getAudioCounts();
            const pendingCount = counts.pending + counts.processing + counts.failed;
            
            if (pendingCount === 0) {
                // Remove badge if no pending audios
                const existingBadge = document.getElementById('pending-audio-badge');
                if (existingBadge) {
                    existingBadge.remove();
                }
                return;
            }
            
            // Find or create badge container
            const recordingSection = document.getElementById('recording-section');
            if (!recordingSection) return;
            
            const header = recordingSection.querySelector('h2');
            if (!header) return;
            
            // Remove existing badge
            let badge = document.getElementById('pending-audio-badge');
            if (badge) {
                badge.remove();
            }
            
            // Create new badge
            badge = document.createElement('span');
            badge.id = 'pending-audio-badge';
            badge.className = 'ml-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded-full cursor-pointer hover:bg-yellow-600';
            badge.textContent = `${pendingCount} pending`;
            badge.title = 'Click to view pending recordings';
            
            // Add click handler to show pending audio list
            badge.addEventListener('click', () => this.showPendingAudioList());
            
            header.appendChild(badge);
        } catch (error) {
            this.log.error('Error showing pending audio badge:', error);
        }
    }

    /**
     * Show list of pending audios
     */
    async showPendingAudioList() {
        try {
            if (!window.PendingAudioManager) return;
            
            const audios = await window.PendingAudioManager.getAudios();
            
            // Create modal or section to show pending audios
            alert(`You have ${audios.length} pending audio recordings.\n\nThis feature will show a detailed list in a future update.`);
            
            // TODO: Implement full UI for viewing and managing pending audios
        } catch (error) {
            this.log.error('Error showing pending audio list:', error);
        }
    }
}
