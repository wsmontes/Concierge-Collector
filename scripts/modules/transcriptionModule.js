/**
 * Manages transcription functionality
 */
class TranscriptionModule {
    constructor(uiManager) {
        // Create module logger instance
        this.log = Logger.module('TranscriptionModule');
        
        this.uiManager = uiManager;
    }

    setupEvents() {
        this.log.debug('Setting up transcription events...');
        
        // Extract concepts button
        const extractConceptsBtn = document.getElementById('extract-concepts');
        if (extractConceptsBtn) {
            extractConceptsBtn.addEventListener('click', () => {
                const transcriptionText = this.uiManager.transcriptionText.innerHTML;
                if (!transcriptionText || transcriptionText.trim().length === 0) {
                    this.uiManager.showNotification('No transcription text to process', 'error');
                    return;
                }
                
                // Call the new processConcepts method that handles both name and concepts extraction
                this.uiManager.conceptModule.processConcepts(transcriptionText);
            });
        }
        
        // Discard transcription button
        const discardTranscriptionBtn = document.getElementById('discard-transcription');
        if (discardTranscriptionBtn) {
            discardTranscriptionBtn.addEventListener('click', () => {
                this.discardTranscription();
            });
        }
        
        this.log.debug('Transcription events set up');
    }
    
    async extractConcepts() {
        this.log.debug('Extract concepts button clicked');
        const transcription = this.uiManager.transcriptionText.textContent.trim();
        
        if (!transcription) {
            this.uiManager.showNotification('No transcription to analyze', 'error');
            return;
        }
        
        try {
            // Save original transcription
            this.uiManager.originalTranscription = transcription;
            
            // Use ApiService V3 instead of legacy apiHandler
            if (!window.ApiService) {
                throw new Error('ApiService not initialized');
            }
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('Authentication required');
            }
            
            // API V3 handles translation internally if needed
            this.uiManager.showLoading('Extracting concepts from text...');
            
            // Use ApiService V3 to extract concepts
            const result = await window.ApiService.extractConcepts(
                transcription, 
                'restaurant'
            );
            
            this.log.debug('Extracted concepts:', result);
            
            // Convert to our internal format
            this.uiManager.currentConcepts = [];
            
            if (result.concepts && Array.isArray(result.concepts)) {
                // API V3 returns concepts as array of {category, value, confidence}
                this.uiManager.currentConcepts = result.concepts.map(c => ({
                    category: c.category,
                    value: c.value
                }));
            } else {
                // Fallback to old format conversion if needed
                for (const category in result) {
                    if (result[category] && Array.isArray(result[category])) {
                        for (const value of result[category]) {
                            this.uiManager.currentConcepts.push({
                                category,
                                value
                            });
                        }
                    }
                }
            }
            
            this.uiManager.hideLoading();
            this.uiManager.showConceptsSection();
        } catch (error) {
            this.uiManager.hideLoading();
            this.log.error('Error extracting concepts:', error);
            this.uiManager.showNotification(`Error extracting concepts: ${error.message}`, 'error');
        }
    }
}
