/**
 * Manages transcription functionality
 */
class TranscriptionModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    setupEvents() {
        console.log('Setting up transcription events...');
        
        // Discard transcription button
        const discardBtn = document.getElementById('discard-transcription');
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                console.log('Discard transcription button clicked');
                this.uiManager.showRecordingSection();
                this.uiManager.transcriptionText.textContent = '';
                this.uiManager.originalTranscription = null;
                this.uiManager.translatedTranscription = null;
            });
        }
        
        // Extract concepts button
        const extractBtn = document.getElementById('extract-concepts');
        if (extractBtn) {
            extractBtn.addEventListener('click', async () => {
                await this.extractConcepts();
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
