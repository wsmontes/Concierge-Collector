# Recording Module Extraction Plan
**Target:** recordingModule.js (2,421 lines)  
**Goal:** Break into 4 services (~400-600 lines each)  
**Estimated Time:** 8-12 hours  
**Priority:** HIGH (most complex, highest bug risk)

---

## Architecture Decision

### Why RecordingModule First?
1. **Clearest service boundaries** - recording, conversion, UI, state are distinct
2. **Highest complexity** - audio conversion logic is error-prone
3. **Most duplicate code** - 18 try/catch blocks, 12 UI update methods
4. **Critical functionality** - transcription bugs affect user experience

### Target Services

```
recordingModule.js (2421 lines)
├── AudioRecordingService.js (~500 lines)
│   ├── MediaRecorder management
│   ├── Stream handling
│   ├── Audio chunk collection
│   └── Browser compatibility
│
├── AudioConversionService.js (~600 lines)
│   ├── MP3 conversion
│   ├── Opus conversion
│   ├── WebM handling
│   └── Strategy pattern for formats
│
├── RecordingUIManager.js (~400 lines)
│   ├── Button state management
│   ├── Timer display
│   ├── Audio visualizer
│   └── Progress indicators
│
├── RecordingStateManager.js (~300 lines)
│   ├── State machine
│   ├── Recording flags
│   ├── Queue management
│   └── Error recovery
│
└── RecordingModule.js (~500 lines) [Orchestrator]
    ├── Service coordination
    ├── Event handling
    ├── Public API
    └── Error delegation
```

---

## Phase 1.1: AudioRecordingService (~4 hours)

### Extraction Target
Lines 450-950 from recordingModule.js

### Responsibilities
```javascript
class AudioRecordingService {
    // Core recording
    async startRecording(constraints)
    async stopRecording()
    pauseRecording()
    resumeRecording()
    
    // Stream management
    async getMediaStream(constraints)
    releaseMediaStream()
    
    // Chunk collection
    handleDataAvailable(event)
    getRecordedBlob()
    clearChunks()
    
    // Browser support
    checkBrowserSupport()
    getBestMimeType()
    getAudioConstraints()
}
```

### Dependencies
- ✅ audioUtils.js (MIME types, validation)
- ✅ errorHandling.js (try/catch replacement)
- window.MediaRecorder (browser API)

### Files to Create
1. `scripts/services/AudioRecordingService.js`
2. `tests/services/AudioRecordingService.test.js`

### Migration Steps
1. Extract MediaRecorder setup (lines 580-620)
2. Extract stream handling (lines 450-500)
3. Extract chunk collection (lines 740-780)
4. Extract browser detection (lines 90-130)
5. Add error handling with errorHandling.js
6. Replace inline MIME type logic with audioUtils.js
7. Write unit tests (80% coverage)

---

## Phase 1.2: AudioConversionService (~4 hours)

### Extraction Target
Lines 890-1320 from recordingModule.js

### Responsibilities
```javascript
class AudioConversionService {
    // Strategy pattern
    async convert(blob, targetFormat)
    
    // Format-specific converters
    async convertToMP3(blob)
    async convertToOpus(blob)
    async webmToOpus(blob)
    simpleConversion(blob, mimeType)
    
    // Audio processing
    decodeAudio(arrayBuffer)
    encodeAudio(audioBuffer, format)
    resizeAudio(audioBuffer, maxDuration)
    
    // Validation
    validateAudioFormat(blob)
    checkFileSize(blob)
}
```

### Strategy Pattern
```javascript
const conversionStrategies = {
    'mp3': MP3ConversionStrategy,
    'opus': OpusConversionStrategy,
    'webm': WebMConversionStrategy,
    'wav': WAVConversionStrategy
};
```

### Dependencies
- ✅ audioUtils.js (blob validation, MIME types)
- ✅ errorHandling.js (retry logic)
- window.AudioContext (browser API)

### Files to Create
1. `scripts/services/AudioConversionService.js`
2. `scripts/services/strategies/MP3ConversionStrategy.js`
3. `scripts/services/strategies/OpusConversionStrategy.js`
4. `tests/services/AudioConversionService.test.js`

### Migration Steps
1. Extract `convertToMP3()` method (lines 890-1140)
2. Extract `webmToOpus()` method (lines 1150-1270)
3. Extract `simpleMP3Conversion()` method (lines 1280-1320)
4. Create strategy interfaces
5. Implement fallback chain
6. Add comprehensive error handling
7. Write unit tests with mock audio blobs

---

## Phase 1.3: RecordingUIManager (~3 hours)

### Extraction Target
Lines 350-450, 950-1050, 1400-1500 (scattered UI updates)

### Responsibilities
```javascript
class RecordingUIManager {
    // Button management
    updateButtonStates(isRecording)
    enableButton(buttonId)
    disableButton(buttonId)
    
    // Timer
    startTimer(elementId)
    stopTimer()
    updateTimer(seconds)
    formatTime(seconds)
    
    // Visualizer
    setupVisualization(analyser, canvasId)
    stopVisualization()
    drawVisualization(dataArray)
    
    // Status indicators
    showRecordingStatus(message, type)
    updateProgress(percent, message)
    hideProgress()
    
    // Preview
    showAudioPreview(audioBlob)
    hideAudioPreview()
}
```

### Dependencies
- ✅ uiHelpers.js (notifications, loading)
- DOM manipulation only

### Files to Create
1. `scripts/services/RecordingUIManager.js`
2. `tests/services/RecordingUIManager.test.js`

### Migration Steps
1. Extract button update logic (12 scattered methods)
2. Extract timer logic (lines 1050-1120)
3. Extract visualizer setup (lines 700-770)
4. Centralize status updates
5. Remove UI logic from recordingModule.js
6. Write unit tests with mock DOM

---

## Phase 1.4: RecordingStateManager (~2 hours)

### Extraction Target
Lines 20-80 (constructor state), scattered state management

### Responsibilities
```javascript
class RecordingStateManager {
    // State machine
    transitionTo(newState)
    getCurrentState()
    canTransition(from, to)
    
    // States: IDLE, RECORDING, PROCESSING, COMPLETED, ERROR
    
    // State queries
    isRecording()
    isProcessing()
    isAdditionalRecording()
    
    // Queue management
    addToQueue(item)
    processQueue()
    clearQueue()
    
    // Error tracking
    recordError(error)
    getErrorCount()
    canRetry()
}
```

### State Machine
```
IDLE → RECORDING → PROCESSING → COMPLETED → IDLE
  ↓                    ↓             ↓
ERROR ←────────────────┴─────────────┘
```

### Dependencies
- None (pure state management)

### Files to Create
1. `scripts/services/RecordingStateManager.js`
2. `tests/services/RecordingStateManager.test.js`

### Migration Steps
1. Extract state flags (lines 20-50)
2. Create state machine
3. Extract queue logic (lines 45-60)
4. Add state validation
5. Replace scattered state checks
6. Write unit tests (100% coverage - critical)

---

## Phase 1.5: Orchestrator Refactor (~2 hours)

### Refactored RecordingModule
```javascript
class RecordingModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
        
        // Service injection
        this.recordingService = new AudioRecordingService();
        this.conversionService = new AudioConversionService();
        this.uiManager = new RecordingUIManager();
        this.stateManager = new RecordingStateManager();
    }
    
    // Public API
    async startRecording() {
        try {
            this.stateManager.transitionTo('RECORDING');
            const stream = await this.recordingService.startRecording();
            this.uiManager.updateButtonStates(true);
            this.uiManager.startTimer();
        } catch (error) {
            this.stateManager.transitionTo('ERROR');
            this.uiManager.showError(error.message);
        }
    }
    
    async stopRecording() {
        try {
            const blob = await this.recordingService.stopRecording();
            this.stateManager.transitionTo('PROCESSING');
            this.uiManager.updateProgress(50, 'Converting audio...');
            
            const converted = await this.conversionService.convert(blob, 'mp3');
            await this.processRecording(converted);
            
            this.stateManager.transitionTo('COMPLETED');
            this.uiManager.stopTimer();
            this.uiManager.updateButtonStates(false);
        } catch (error) {
            this.stateManager.transitionTo('ERROR');
            await this.handleRecordingError(error);
        }
    }
    
    // Event delegation
    setupEvents() {
        // Delegate to services
    }
}
```

### Migration Steps
1. Replace inline logic with service calls
2. Add dependency injection
3. Implement error delegation
4. Remove duplicate code
5. Update tests
6. Integration testing

---

## Testing Strategy

### Unit Tests (Per Service)
- **AudioRecordingService:** Mock MediaRecorder, test all recording states
- **AudioConversionService:** Mock AudioContext, test conversion strategies
- **RecordingUIManager:** Mock DOM, test all UI updates
- **RecordingStateManager:** No mocks needed, test state transitions

### Integration Tests
- Full recording flow: start → record → stop → convert → transcribe
- Error scenarios: permission denied, conversion failure, network error
- Additional recording flow
- Multiple recordings in sequence

### Coverage Target
- Unit tests: 80% minimum
- Integration tests: Critical paths 100%
- E2E tests: Happy path + 3 error scenarios

---

## Rollout Plan

### Step 1: Create Services (Parallel)
- Day 1-2: AudioRecordingService + AudioConversionService
- Day 2-3: RecordingUIManager + RecordingStateManager

### Step 2: Integration
- Day 3: Wire services into RecordingModule orchestrator
- Day 3-4: Update event handlers
- Day 4: Replace inline logic with service calls

### Step 3: Testing
- Day 4-5: Write unit tests (80% coverage)
- Day 5: Write integration tests
- Day 5-6: Manual testing + bug fixes

### Step 4: Deployment
- Day 6: Code review
- Day 6: Merge to refactor branch
- Day 6-7: QA testing

---

## Success Metrics

### Code Quality
- ✅ Reduce recordingModule.js from 2,421 → ~500 lines
- ✅ Create 4 services totaling ~1,800 lines (organized)
- ✅ Eliminate 18 duplicate try/catch blocks
- ✅ Eliminate 12 scattered UI update methods
- ✅ 80%+ test coverage

### Maintainability
- ✅ Single responsibility per service
- ✅ Clear service boundaries
- ✅ Dependency injection
- ✅ Strategy pattern for extensibility

### Bug Risk
- ✅ State machine prevents invalid transitions
- ✅ Centralized error handling
- ✅ Retry logic in one place
- ✅ Audio conversion failures isolated

---

## Next Steps After Completion

1. **Immediate:** Apply same pattern to conceptModule (2,511 lines)
2. **Short-term:** Extract placesModule services
3. **Long-term:** Create service registry for dependency injection
