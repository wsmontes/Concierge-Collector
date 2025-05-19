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
            
            // Create the recording section HTML - updated with non-rounded buttons
            recordingSection.innerHTML = `
                <h2 class="text-xl font-bold mb-2 flex items-center">
                    <span class="material-icons mr-1 text-red-600">mic</span>
                    Record Your Restaurant Review
                </h2>
                <p class="text-sm text-gray-600 mb-4">Record your review of the restaurant to automatically extract information.</p>
                
                <div class="recording-controls flex flex-wrap items-center gap-2 mb-4">
                    <button id="start-record" class="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded flex items-center">
                        <span class="material-icons mr-1">mic</span>
                        Start Recording
                    </button>
                    <button id="stop-record" class="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded flex items-center hidden">
                        <span class="material-icons mr-1">stop</span>
                        Stop Recording
                    </button>
                    <div id="recording-time" class="px-3 py-2 bg-white border rounded text-sm hidden">00:00</div>
                    <div id="recording-status" class="text-sm text-gray-600 ml-2"></div>
                </div>
                
                <div id="audio-visualizer" class="h-16 mb-4 bg-black rounded overflow-hidden hidden">
                    <canvas id="audio-visualizer-canvas" class="w-full h-full"></canvas>
                </div>
                
                <!-- Circular timer and audio preview section -->
                <div id="circular-timer-section" class="hidden">
                    <div id="timer" class="text-center text-4xl font-bold mb-2">00:00</div>
                    <div class="flex justify-center gap-2">
                        <button id="discard-recording" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded">
                            <span class="material-icons mr-1">delete</span>
                            Discard Recording
                        </button>
                    </div>
                </div>
                
                <div id="audio-preview" class="hidden mt-4">
                    <h3 class="text-lg font-semibold mb-2">Recording Preview</h3>
                    <audio id="recorded-audio" controls class="w-full mb-2"></audio>
                    <div class="flex gap-2">
                        <button id="transcribe-recording" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">
                            <span class="material-icons mr-1">transcribe</span>
                            Transcribe Recording
                        </button>
                        <button id="analyze-recording" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">
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
                    controlsContainer.className = 'recording-controls flex flex-wrap items-center gap-2 mb-4';
                    recordingSection.appendChild(controlsContainer);
                } else {
                    // Clear existing buttons to prevent duplicates
                    controlsContainer.innerHTML = '';
                }
                
                // Add start button with consistent styling (not rounded)
                const newStartBtn = document.createElement('button');
                newStartBtn.id = 'start-record';
                newStartBtn.className = 'bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded flex items-center';
                newStartBtn.innerHTML = '<span class="material-icons mr-1">mic</span>Start Recording';
                controlsContainer.appendChild(newStartBtn);
                console.log('Added missing start-record button');
                
                // Add stop button with consistent styling (not rounded)
                const newStopBtn = document.createElement('button');
                newStopBtn.id = 'stop-record';
                newStopBtn.className = 'bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded flex items-center hidden';
                newStopBtn.innerHTML = '<span class="material-icons mr-1">stop</span>Stop Recording';
                controlsContainer.appendChild(newStopBtn);
                console.log('Added missing stop-record button');
                
                // Add recording time display if missing
                if (!recordingSection.querySelector('#recording-time')) {
                    const timeDisplay = document.createElement('div');
                    timeDisplay.id = 'recording-time';
                    timeDisplay.className = 'px-3 py-2 bg-white border rounded text-sm hidden';
                    timeDisplay.textContent = '00:00';
                    controlsContainer.appendChild(timeDisplay);
                }
                
                // Add recording status display if missing
                if (!recordingSection.querySelector('#recording-status')) {
                    const statusDisplay = document.createElement('div');
                    statusDisplay.id = 'recording-status';
                    statusDisplay.className = 'text-sm text-gray-600 ml-2';
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
            console.log('Error starting recording:', error);
            throw error;
        }
    }

    /**
     * Stops recording audio and shows preview
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
                        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                        
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
                        
                        // Fix for missing showAudioPreview function
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
     * Start a timer for recording duration - fixed to work with both main and additional UI
     * @param {HTMLElement} timerElement - Element to show timer in
     */
    startRecordingTimer(timerElement) {
        // Always update both main and additional counters for robustness
        const mainTimer = document.getElementById('recording-time');
        const additionalTimer = document.getElementById('additional-recording-time');
        this.recordingStartTime = Date.now();

        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }

        this.recordingTimer = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
            const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
            const formattedTime = `${minutes}:${seconds}`;

            // Update main rectangular timer if present
            if (mainTimer) {
                mainTimer.textContent = formattedTime;
                mainTimer.classList.remove('hidden');
            }
            // Update additional small timer if present
            if (additionalTimer) {
                additionalTimer.textContent = formattedTime;
                additionalTimer.classList.remove('hidden');
            }
            // Update circular timer if present
            const circularTimer = document.getElementById('timer');
            if (circularTimer) {
                circularTimer.textContent = formattedTime;
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
     * Process transcription results with improved mode detection
     * @param {string} transcription - The transcribed text
     */
    processTranscription(transcription) {
        try {
            // Determine if this is an additional recording or edit mode
            const isAdditional = this.uiManager && this.uiManager.isRecordingAdditional;
            const isEditMode = this.uiManager && this.uiManager.isEditMode;
            
            console.log(`Processing transcription, length: ${transcription?.length || 0}, additional mode: ${isAdditional}, edit mode: ${isEditMode}`);
            
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
                
                // Route additional recording to concept module handler
                if (this.uiManager && this.uiManager.conceptModule && 
                    typeof this.uiManager.conceptModule.handleAdditionalRecordingComplete === 'function') {
                    console.log('Routing additional recording to concept module handler');
                    this.uiManager.conceptModule.handleAdditionalRecordingComplete(transcription);
                    return;
                }
            } else {
                // For main recording functionality, use the original behavior
                // Update UI elements specific to main recording
                const recordingStatus = document.getElementById('recording-status');
                if (recordingStatus) {
                    recordingStatus.innerHTML = `
                        <div class="flex items-center text-green-700">
                            <span class="material-icons text-green-500 mr-1">check_circle</span>
                            <span>Recording Complete</span>
                        </div>
                    `;
                }
            }
            
            // Common handling for both types of recordings - fallbacks when expected handlers don't exist
            
            // First try with uiManager's handleTranscriptionComplete
            if (this.uiManager && typeof this.uiManager.handleTranscriptionComplete === 'function') {
                console.log('Using uiManager.handleTranscriptionComplete');
                this.uiManager.handleTranscriptionComplete(transcription, isEditMode || isAdditional);
                return;
            }
            
            // Then try with the global function
            if (window.handleTranscriptionComplete && typeof window.handleTranscriptionComplete === 'function') {
                console.log('Using global handleTranscriptionComplete');
                window.handleTranscriptionComplete(transcription, isEditMode || isAdditional);
                return;
            }
            
            // Last resort: update textarea directly
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                console.log('Updating transcription textarea directly');
                // Always append new transcription with a newline, never replace
                const currentContent = transcriptionTextarea.value || '';
                const separator = currentContent.trim() ? '\n\n' : '';
                transcriptionTextarea.value = currentContent + separator + transcription;
                transcriptionTextarea.scrollTop = transcriptionTextarea.scrollHeight;
                
                // Highlight the update
                transcriptionTextarea.classList.add('highlight-update');
                setTimeout(() => {
                    transcriptionTextarea.classList.remove('highlight-update');
                }, 1000);
                
                // Process concepts if possible
                if (this.uiManager && this.uiManager.conceptModule && 
                    typeof this.uiManager.conceptModule.processConcepts === 'function') {
                    this.uiManager.conceptModule.processConcepts(transcription);
                }
                
                return;
            }
            
            // If all else fails, log the transcription
            console.warn('No handler available for transcription, logging to console');
            console.log('Transcription result:', transcription);
            
        } catch (error) {
            console.error('Error processing transcription:', error);
        }
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
