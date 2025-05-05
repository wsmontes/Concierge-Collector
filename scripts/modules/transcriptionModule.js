/**
 * Manages transcription functionality
 */
class TranscriptionModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    setupEvents() {
        console.log('Setting up transcription events...');
        
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
        
        console.log('Transcription events set up');
    }
    
    async extractConcepts() {
        console.log('Extract concepts button clicked');
        const transcription = this.uiManager.transcriptionText.textContent.trim();
        
        if (!transcription) {
            this.uiManager.showNotification('No transcription to analyze', 'error');
            return;
        }
        
        try {
            // Save original transcription
            this.uiManager.originalTranscription = transcription;
            
            // First translate the text to English for concept extraction
            this.uiManager.showLoading('Translating text to English...');
            const translatedText = await apiHandler.translateText(transcription);
            this.uiManager.translatedTranscription = translatedText;
            
            console.log('Original text:', transcription);
            console.log('Translated text:', translatedText);
            
            // Then extract concepts using the translated text
            this.uiManager.showLoading('Extracting concepts from translated text...');
            
            // Use GPT-4 to extract concepts from the translated text
            const extractedConcepts = await apiHandler.extractConcepts(
                translatedText, 
                promptTemplates.conceptExtraction
            );
            
            console.log('Extracted concepts:', extractedConcepts);
            
            // Convert to our internal format
            this.uiManager.currentConcepts = [];
            
            for (const category in extractedConcepts) {
                if (extractedConcepts[category] && Array.isArray(extractedConcepts[category])) {
                    for (const value of extractedConcepts[category]) {
                        this.uiManager.currentConcepts.push({
                            category,
                            value
                        });
                    }
                }
            }
            
            this.uiManager.hideLoading();
            this.uiManager.showConceptsSection();
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error extracting concepts:', error);
            this.uiManager.showNotification(`Error extracting concepts: ${error.message}`, 'error');
        }
    }
}
