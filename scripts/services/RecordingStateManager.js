/**
 * Recording State Manager - State machine for recording lifecycle
 * 
 * Purpose: Manages recording state transitions and validates state changes
 * 
 * Main Responsibilities:
 * - State machine (IDLE → RECORDING → PROCESSING → COMPLETED)
 * - State validation and transitions
 * - Queue management for batch operations
 * - Error tracking and retry logic
 * 
 * Dependencies: None (pure state management)
 */

class RecordingStateManager {
    constructor() {
        this.log = Logger.module('RecordingStateManager');
        
        // States
        this.STATES = {
            IDLE: 'idle',
            RECORDING: 'recording',
            PROCESSING: 'processing',
            COMPLETED: 'completed',
            ERROR: 'error'
        };
        
        // Valid state transitions
        this.TRANSITIONS = {
            [this.STATES.IDLE]: [this.STATES.RECORDING],
            [this.STATES.RECORDING]: [this.STATES.PROCESSING, this.STATES.ERROR, this.STATES.IDLE],
            [this.STATES.PROCESSING]: [this.STATES.COMPLETED, this.STATES.ERROR],
            [this.STATES.COMPLETED]: [this.STATES.IDLE],
            [this.STATES.ERROR]: [this.STATES.IDLE, this.STATES.RECORDING]
        };
        
        // Current state
        this.currentState = this.STATES.IDLE;
        
        // Additional recording flag
        this.isAdditionalRecording = false;
        
        // Processing queue
        this.processingQueue = [];
        this.isProcessingQueue = false;
        
        // Error tracking
        this.errors = [];
        this.maxErrors = 5;
        
        // Retry configuration
        this.retryCount = 0;
        this.maxRetries = 3;
    }
    
    /**
     * Get current state
     * @returns {string} - Current state
     */
    getState() {
        return this.currentState;
    }
    
    /**
     * Check if transition is valid
     * @param {string} fromState - Current state
     * @param {string} toState - Target state
     * @returns {boolean} - Whether transition is valid
     */
    canTransition(fromState, toState) {
        const validTransitions = this.TRANSITIONS[fromState];
        return validTransitions && validTransitions.includes(toState);
    }
    
    /**
     * Transition to new state
     * @param {string} newState - Target state
     * @param {Object} context - Additional context
     * @returns {boolean} - Whether transition succeeded
     */
    transitionTo(newState, context = {}) {
        if (!this.canTransition(this.currentState, newState)) {
            this.log.warn(`Invalid transition: ${this.currentState} → ${newState}`);
            return false;
        }
        
        const previousState = this.currentState;
        this.currentState = newState;
        
        this.log.debug(`State transition: ${previousState} → ${newState}`, context);
        
        // Handle state entry actions
        this.handleStateEntry(newState, context);
        
        return true;
    }
    
    /**
     * Handle state entry actions
     * @param {string} state - State being entered
     * @param {Object} context - Additional context
     */
    handleStateEntry(state, context) {
        switch (state) {
            case this.STATES.RECORDING:
                this.retryCount = 0;
                break;
                
            case this.STATES.ERROR:
                this.recordError(context.error);
                this.retryCount++;
                break;
                
            case this.STATES.COMPLETED:
                this.retryCount = 0;
                break;
                
            case this.STATES.IDLE:
                this.isAdditionalRecording = false;
                break;
        }
    }
    
    /**
     * Check if currently recording
     * @returns {boolean}
     */
    isRecording() {
        return this.currentState === this.STATES.RECORDING;
    }
    
    /**
     * Check if currently processing
     * @returns {boolean}
     */
    isProcessing() {
        return this.currentState === this.STATES.PROCESSING;
    }
    
    /**
     * Check if in error state
     * @returns {boolean}
     */
    isError() {
        return this.currentState === this.STATES.ERROR;
    }
    
    /**
     * Check if in idle state
     * @returns {boolean}
     */
    isIdle() {
        return this.currentState === this.STATES.IDLE;
    }
    
    /**
     * Set additional recording flag
     * @param {boolean} isAdditional - Whether this is additional recording
     */
    setAdditionalRecording(isAdditional) {
        this.isAdditionalRecording = isAdditional;
        this.log.debug('Additional recording flag:', isAdditional);
    }
    
    /**
     * Get additional recording flag
     * @returns {boolean}
     */
    getAdditionalRecording() {
        return this.isAdditionalRecording;
    }
    
    /**
     * Add item to processing queue
     * @param {Object} item - Item to process
     */
    addToQueue(item) {
        this.processingQueue.push(item);
        this.log.debug(`Added to queue. Queue size: ${this.processingQueue.length}`);
    }
    
    /**
     * Get next item from queue
     * @returns {Object|null} - Next item or null
     */
    getNextFromQueue() {
        return this.processingQueue.shift() || null;
    }
    
    /**
     * Get queue size
     * @returns {number} - Number of items in queue
     */
    getQueueSize() {
        return this.processingQueue.length;
    }
    
    /**
     * Clear processing queue
     */
    clearQueue() {
        this.processingQueue = [];
        this.log.debug('Queue cleared');
    }
    
    /**
     * Set queue processing flag
     * @param {boolean} isProcessing - Whether queue is being processed
     */
    setProcessingQueue(isProcessing) {
        this.isProcessingQueue = isProcessing;
    }
    
    /**
     * Get queue processing flag
     * @returns {boolean}
     */
    getProcessingQueue() {
        return this.isProcessingQueue;
    }
    
    /**
     * Record an error
     * @param {Error} error - Error to record
     */
    recordError(error) {
        this.errors.push({
            error,
            timestamp: new Date(),
            state: this.currentState,
            retryCount: this.retryCount
        });
        
        // Keep only recent errors
        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }
        
        this.log.error('Error recorded:', error);
    }
    
    /**
     * Get error count
     * @returns {number} - Number of errors
     */
    getErrorCount() {
        return this.errors.length;
    }
    
    /**
     * Get recent errors
     * @param {number} count - Number of recent errors to get
     * @returns {Array} - Recent errors
     */
    getRecentErrors(count = 5) {
        return this.errors.slice(-count);
    }
    
    /**
     * Check if can retry
     * @returns {boolean} - Whether retry is allowed
     */
    canRetry() {
        return this.retryCount < this.maxRetries;
    }
    
    /**
     * Get retry count
     * @returns {number} - Current retry count
     */
    getRetryCount() {
        return this.retryCount;
    }
    
    /**
     * Reset retry count
     */
    resetRetryCount() {
        this.retryCount = 0;
        this.log.debug('Retry count reset');
    }
    
    /**
     * Clear all errors
     */
    clearErrors() {
        this.errors = [];
        this.retryCount = 0;
        this.log.debug('Errors cleared');
    }
    
    /**
     * Force reset to idle state
     */
    forceReset() {
        this.log.warn('Force resetting to idle state');
        this.currentState = this.STATES.IDLE;
        this.isAdditionalRecording = false;
        this.clearQueue();
        this.clearErrors();
    }
    
    /**
     * Get state machine status
     * @returns {Object} - Complete state status
     */
    getStatus() {
        return {
            currentState: this.currentState,
            isAdditionalRecording: this.isAdditionalRecording,
            queueSize: this.processingQueue.length,
            isProcessingQueue: this.isProcessingQueue,
            errorCount: this.errors.length,
            retryCount: this.retryCount,
            canRetry: this.canRetry()
        };
    }
}

window.RecordingStateManager = RecordingStateManager;
console.debug('[RecordingStateManager] Service initialized');
