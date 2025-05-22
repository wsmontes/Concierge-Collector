/**
 * Recording Module - Handles audio recording and transcription
 * Dependencies: Whisper API, uiManager
 * Enhanced for mobile compatibility and consistent MP3 conversion
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
                console.log(`Selected recording format: ${mimeType}`);
                break;
            }
        }
        
        // If no supported type is found, let browser use default
        if (!this.recordingSettings.mimeType) {
            console.warn('No explicit MIME type support detected, using browser default');
        }
    }

    /**
     * Creates and initializes the recording interface if not already present
     * @returns {void}
     */
    ensureRecordingInterfaceExists() {
        console.log('Ensuring recording interface exists in the DOM');
        
        // First, check if there are duplicate recording controls and remove them
        this.removeDuplicateRecordingControls();
        
        // Check if the recording section exists
        let recordingSection = document.getElementById('recording-section');
        
        // If it doesn't exist, we need to create it
        if (!recordingSection) {
            console.log('Recording section not found, creating it');
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
            
            console.log('Recording section created and added to the DOM');
        } else {
            console.log('Recording section already exists');
            
            // Check if the section has the correct structure - if not, repair it
            const startBtn = recordingSection.querySelector('#start-record');
            const stopBtn = recordingSection.querySelector('#stop-record');
            
            if (!startBtn || !stopBtn) {
                console.log('Recording buttons missing - repairing recording section structure');
                
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
                console.log('Added missing start-record button');
                
                // Add stop button with mobile-friendly styling
                const newStopBtn = document.createElement('button');
                newStopBtn.id = 'stop-record';
                newStopBtn.className = 'bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded flex items-center text-lg md:text-base hidden';
                newStopBtn.innerHTML = '<span class="material-icons mr-1">stop</span>Stop Recording';
                controlsContainer.appendChild(newStopBtn);
                console.log('Added missing stop-record button');
                
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
            console.warn('Start record button still missing after section creation/repair');
        }
        
        if (!stopBtn) {
            console.warn('Stop record button still missing after section creation/repair');
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
            console.log('Removing round button:', btn.outerHTML);
            if (btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        });
        
        // If we have more than one recording controls section, keep only the first one
        if (recordingControlsElements.length > 1) {
            console.log(`Found ${recordingControlsElements.length} recording control sections, removing duplicates`);
            
            // Keep the first one, remove the rest
            for (let i = 1; i < recordingControlsElements.length; i++) {
                const element = recordingControlsElements[i];
                console.log('Removing duplicate recording controls:', element.outerHTML);
                
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
        console.log(`Looking for alternative ${type} record buttons...`);
        
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
                console.log(`Found alternative ${type} button with ID: ${id}`);
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
                console.log(`Found ${type} button by text content`);
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
                        console.log(`Found ${type} button by icon`);
                        this.replaceWithCorrectButton(btn, type);
                        return btn;
                    }
                }
            }
        } catch (e) {
            console.warn('Error finding buttons by icon:', e);
        }
        
        console.log(`No alternative ${type} button found`);
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
                console.log(`Replaced ${type} button with correct ID`);
            }
        } catch (e) {
            console.error(`Error replacing ${type} button:`, e);
        }
    }

    /**
     * Setup event listeners for recording functionality with enhanced button finding
     */
    setupEvents() {
        console.log('Setting up recording events...');
        
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
            
            console.log('Recording events setup completed');
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
            console.log('Found start-record button, attaching event listener');
            
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
            console.warn('Start recording button not found in DOM');
        }
        
        // Stop recording button
        if (stopRecordBtn) {
            console.log('Found stop-record button, attaching event listener');
            
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
            console.warn('Stop recording button not found in DOM');
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
            console.log('Found additional-record-start button, attaching event listener');
            
            // Remove any existing listeners
            additionalStartBtn.removeEventListener('click', this.handleAdditionalStartRecording);
            
            // Create handler that sets the additional flag and calls startRecording
            this.handleAdditionalStartRecording = this.handleAdditionalStartRecording || (async () => {
                console.log('Additional record start button clicked');
                if (this.uiManager) {
                    this.uiManager.isRecordingAdditional = true;
                }
                try {
                    await this.startRecording();
                } catch (error) {
                    console.error('Error starting additional recording:', error);
                    // Reset the flag on error
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
                    }
                    
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
            console.log('Found additional-record-stop button, attaching event listener');
            
            // Remove any existing listeners
            additionalStopBtn.removeEventListener('click', this.handleAdditionalStopRecording);
            
            // Create handler that calls stopRecording
            this.handleAdditionalStopRecording = this.handleAdditionalStopRecording || (async () => {
                console.log('Additional record stop button clicked');
                try {
                    await this.stopRecording();
                } catch (error) {
                    console.error('Error stopping additional recording:', error);
                    // Show error notification
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        window.uiUtils.showNotification('Error stopping recording: ' + error.message, 'error');
                    }
                } finally {
                    // Ensure flag is reset even on error
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
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
                console.log('Recording buttons dynamically added, reattaching event listeners');
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
                console.log('Stopping button observer after timeout');
                this.buttonObserver.disconnect();
                this.buttonObserver = null;
            }
        }, 3600000); // 1 hour
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
            console.log(`Starting recording, additional mode: ${isAdditional}`);
            
            // Update UI for additional recording mode
            if (isAdditional) {
                // Additional recording UI updates
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
            } else {
                // Regular recording UI updates
                const startBtn = document.getElementById('start-record');
                const stopBtn = document.getElementById('stop-record');
                
                if (startBtn) startBtn.classList.add('hidden');
                if (stopBtn) stopBtn.classList.remove('hidden');
            }
            
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
                console.log('iOS Safari detected, using simplified audio constraints');
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
            console.log('Creating MediaRecorder with options:', options);
            
            try {
                this.mediaRecorder = new MediaRecorder(stream, options);
            } catch (err) {
                console.warn(`Error creating MediaRecorder with options: ${err.message}, trying without options`);
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
                    console.log('Auto-stopping recording due to max duration limit');
                    this.stopRecording().catch(err => console.error('Error auto-stopping recording:', err));
                }
            }, maxRecordingDuration);
            
            // Start recording with 1 second chunks for more responsive recording
            this.mediaRecorder.start(1000);
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
            }
            
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
            console.error('Error starting recording:', error);
            
            // Special handling for common mobile issues
            if (error.name === 'NotAllowedError') {
                alert('Microphone access denied. Please allow microphone access in your browser settings to record audio.');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please connect a microphone and try again.');
            }
            
            // Reset UI state
            const startBtn = document.getElementById('start-record');
            const stopBtn = document.getElementById('stop-record');
            
            if (startBtn) startBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            
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
            // Determine if this is an additional recording
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            console.log(`Stopping recording, additional mode: ${isAdditional}`);
            
            // Update UI for additional recording mode
            if (isAdditional) {
                // Additional recording UI updates
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
            } else {
                // Regular recording UI updates
                const startBtn = document.getElementById('start-record');
                const stopBtn = document.getElementById('stop-record');
                
                if (startBtn) startBtn.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
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
                        const audioBlob = new Blob(this.audioChunks, { type: this.getOutputMimeType() });
                        
                        // Stop all tracks in the media stream
                        if (this.mediaStream) {
                            this.mediaStream.getTracks().forEach(track => track.stop());
                        }
                        
                        // Update recording status
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
                        if (typeof this.stopVisualization === 'function') {
                            this.stopVisualization();
                        }
                        
                        // Stop timer but keep timer display visible
                        this.stopRecordingTimer();
                        
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
                    timer.textContent = formattedTime;
                    timer.classList.remove('hidden');
                    
                    // Add visual indicator when approaching max duration (4+ minutes)
                    if (elapsedSeconds >= 240) {
                        timer.classList.add('text-red-600');
                        timer.classList.add('font-bold');
                    } else {
                        timer.classList.remove('text-red-600');
                        timer.classList.remove('font-bold');
                    }
                }
            });
            
            // Update circular timer pulsating effect if present
            const circularTimer = document.getElementById('timer');
            if (circularTimer) {
                const pulsateElement = circularTimer.parentElement.querySelector('.pulsate');
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
            circularTimer.textContent = '00:00';
            const pulsateElement = circularTimer.parentElement.querySelector('.pulsate');
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
            console.log('Starting MP3 conversion, audio type:', audioBlob.type);
            
            // If we already have MP3, just return it
            if (audioBlob.type === 'audio/mpeg' || audioBlob.type === 'audio/mp3') {
                console.log('Audio already in MP3 format, skipping conversion');
                return audioBlob;
            }
            
            // For iOS Safari, we need a simpler approach since it may not support certain Web APIs
            if (this.isIOSSafari()) {
                console.log('Using simplified MP3 conversion for iOS Safari');
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
                            console.error('Invalid audio data: empty buffer');
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
                            console.warn('Audio decoding failed, trying alternative approach:', decodeError.message);
                            
                            // Try direct WebM to Opus conversion (Whisper can handle Opus)
                            try {
                                const opusBlob = await this.webmToOpus(audioBlob);
                                if (opusBlob && opusBlob.size > 0) {
                                    console.log(`Converted to Opus format: ${opusBlob.size} bytes`);
                                    resolve(opusBlob);
                                    return;
                                }
                            } catch (opusError) {
                                console.warn('Opus conversion failed:', opusError);
                            }
                            
                            // Then try with audio element as another fallback
                            try {
                                audioBuffer = await this.decodeAudioUsingElement(audioBlob);
                            } catch (elementError) {
                                console.error('All decoding approaches failed:', elementError);
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
                                    console.warn('Conversion produced an empty blob, using original as fallback');
                                    resolve(audioBlob);
                                    return;
                                }
                                
                                console.log(`MP3 conversion complete: ${outputBlob.size} bytes, type: ${outputBlob.type}`);
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
                                    console.warn('Error stopping recorder:', stopError);
                                    resolve(audioBlob); // Fallback to original
                                }
                            }, (audioBuffer.duration * 1000) + 500);
                            
                        } catch (processingError) {
                            console.error('Error processing audio buffer:', processingError);
                            // Return a specially marked blob to indicate the need for server-side processing
                            resolve(new Blob([arrayBuffer], { 
                                type: 'audio/wav'  // Use WAV as a more universal format
                            }));
                        }
                        
                    } catch (err) {
                        console.error('Error in MP3 conversion:', err);
                        // Simple fallback conversion
                        try {
                            const simpleResult = await this.simpleMP3Conversion(audioBlob);
                            resolve(simpleResult);
                        } catch (fallbackError) {
                            console.error('Simple conversion failed too:', fallbackError);
                            // Last resort: return original with MP3 mime type for better API compatibility
                            const repackagedBlob = new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
                            resolve(repackagedBlob);
                        }
                    }
                };
                
                fileReader.onerror = async (error) => {
                    console.error('FileReader error during MP3 conversion:', error);
                    try {
                        // Try simple conversion as fallback
                        const simpleResult = await this.simpleMP3Conversion(audioBlob);
                        resolve(simpleResult);
                    } catch (fallbackError) {
                        console.error('Simple conversion failed too:', fallbackError);
                        resolve(audioBlob); // Ultimate fallback to original
                    }
                };
                
                fileReader.readAsArrayBuffer(audioBlob);
            });
        } catch (err) {
            console.error('Exception in convertToMP3:', err);
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
            console.log('Starting simple conversion process');
            
            // Create a new blob with MP3 MIME type for better compatibility with Whisper API
            // This isn't actually converting the format, just changing the content type
            const processedBlob = new Blob([await audioBlob.arrayBuffer()], { 
                type: 'audio/mp3'  // Whisper API expects this MIME type
            });
            
            if (processedBlob.size === 0) {
                throw new Error('Conversion resulted in empty blob');
            }
            
            console.log(`Simple conversion complete: ${processedBlob.size} bytes, type: ${processedBlob.type}`);
            return processedBlob;
        } catch (err) {
            console.error('Error in simple MP3 conversion:', err);
            // Last resort: return the original blob but with MP3 MIME type
            return new Blob([await audioBlob.arrayBuffer()], { type: 'audio/mp3' });
        }
    }

    /**
     * Transcribe (and translate) audio to English using Whisper API.
     * Always produces English text, no matter the spoken language.
     * @param {Blob} audioBlob - Audio blob from recorder
     * @returns {Promise<string>} - English transcription text
     */
    async transcribeAudio(audioBlob) {
        console.log('Transcribing audio with Whisper API...');
        const apiKey = localStorage.getItem('openai_api_key');
        if (!apiKey) throw new Error('OpenAI API key not set');

        // Wrap blob in File to provide filename+MIME
        const ext       = audioBlob.type.split('/')[1].split(';')[0] || 'webm';
        const audioFile = new File([audioBlob], `recording.${ext}`, { type: audioBlob.type });

        const form = new FormData();
        form.append('file', audioFile);
        form.append('model', 'whisper-1');

        // Use the Whisper "translations" endpoint for English output
        const resp = await fetch('https://api.openai.com/v1/audio/translations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form
        });

        if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            throw new Error(`API error: ${resp.status} - ${errJson.error?.message || resp.statusText}`);
        }

        const data = await resp.json();
        return data.text;
    }

    /**
     * Process a finished recording (standard or additional), convert to MP3/Opus, and send to Whisper.
     * @param {Blob} audioBlob - Raw recording blob from MediaRecorder
     */
    async processRecording(audioBlob) {
        try {
            console.log('Processing recording, original format:', audioBlob.type);
            
            // Convert the blob into a compatible MP3/Opus blob
            const preparedBlob = await this.convertToMP3(audioBlob);
            console.log('Prepared blob for transcription:', preparedBlob.type, preparedBlob.size);
            
            // Send to Whisper using multipart/form-data
            const transcription = await this.transcribeAudio(preparedBlob);
            
            // Append transcription to the textarea
            this.processTranscription(transcription);

            // Signal UI that transcription is done
            this.updateProcessingStatus('transcription', 'done');
        } catch (error) {
            console.error('Error processing recording:', error);
            this.updateProcessingStatus('transcription', 'error');
            // Notify user
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(`Error transcribing audio: ${error.message}`, 'error');
            }
            throw error;
        }
    }

    /**
     * Process transcription results with improved handling for all recording scenarios
     * Always appends to the textarea instead of replacing it.
     */
    processTranscription(transcription) {
        try {
            const textarea = document.getElementById('restaurant-transcription');
            if (textarea) {
                const prev = textarea.value.trim();
                textarea.value = prev
                    ? `${prev}\n${transcription}`
                    : transcription;
                textarea.dispatchEvent(new Event('input'));
            }
        } catch (error) {
            console.error('Error processing transcription:', error);
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
        
        console.log('Setting up event delegation for recording buttons');
        
        document.addEventListener('click', async (event) => {
            // Handle start recording button
            if (event.target.id === 'start-record' || 
                (event.target.parentElement && event.target.parentElement.id === 'start-record')) {
                console.log('Start recording clicked via delegation');
                try {
                    await this.startRecording();
                } catch (error) {
                    console.error('Error starting recording via delegation:', error);
                }
            }
            
            // Handle stop recording button
            if (event.target.id === 'stop-record' || 
                (event.target.parentElement && event.target.parentElement.id === 'stop-record')) {
                console.log('Stop recording clicked via delegation');
                try {
                    await this.stopRecording();
                } catch (error) {
                    console.error('Error stopping recording via delegation:', error);
                }
            }
            
            // Handle additional record start button
            if (event.target.id === 'additional-record-start' || 
                (event.target.parentElement && event.target.parentElement.id === 'additional-record-start')) {
                console.log('Additional record start clicked via delegation');
                try {
                    // Set the additional recording flag
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = true;
                    }
                    await this.startRecording();
                } catch (error) {
                    console.error('Error starting additional recording via delegation:', error);
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
                    }
                }
            }
            
            // Handle additional record stop button
            if (event.target.id === 'additional-record-stop' || 
                (event.target.parentElement && event.target.parentElement.id === 'additional-record-stop')) {
                console.log('Additional record stop clicked via delegation');
                try {
                    await this.stopRecording();
                } catch (error) {
                    console.error('Error stopping additional recording via delegation:', error);
                } finally {
                    // Ensure flag is reset
                    if (this.uiManager) {
                        this.uiManager.isRecordingAdditional = false;
                    }
                }
            }
        });
        
        console.log('Event delegation for recording buttons completed');
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
                console.warn(`Audio preview container not found for ${isAdditional ? 'additional' : 'standard'} recording`);
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
            
            console.log(`Audio preview created for ${isAdditional ? 'additional' : 'standard'} recording`);
        } catch (error) {
            console.error('Error displaying audio preview:', error);
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
            console.error(`Error updating ${type} status:`, error);
        }
    }
}
