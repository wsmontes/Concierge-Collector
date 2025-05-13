/**
 * Handles concept matching using text similarity (fallback approach)
 */

// Only define the class if it doesn't already exist
const ConceptMatcher = ModuleWrapper.defineClass('ConceptMatcher', class {
    constructor() {
        this.similarityThreshold = 0.7; // Default similarity threshold
        this.modelLoaded = true; // Always "loaded" with our fallback
    }

    async loadModel() {
        // Since we're not using transformers.js, we'll just notify that we're using the fallback approach
        console.log("Using simple string matching fallback instead of ML-based matching");
        
        // Show notification to user
        Toastify({
            text: "Using simplified concept matching (ML library unavailable)",
            duration: 3000,
            gravity: "bottom",
            position: "center",
            style: { background: "linear-gradient(to right, #ff9966, #ff5e62)" }
        }).showToast();
        
        // We're already "loaded" with our fallback approach
        return true;
    }

    setSimilarityThreshold(threshold) {
        this.similarityThreshold = threshold;
    }

    async getEmbedding(text) {
        // Instead of embeddings, we'll just normalize the text for comparison
        return this.normalizeText(text);
    }

    async findSimilarConcepts(newConcept, existingConcepts, categoryFilter = true) {
        try {
            // Filter concepts by category if requested
            const filteredConcepts = categoryFilter 
                ? existingConcepts.filter(c => c.category === newConcept.category) 
                : existingConcepts;
            
            if (filteredConcepts.length === 0) return [];
            
            // Normalize the new concept text
            const normalizedNewText = this.normalizeText(newConcept.value);
            
            // Calculate similarity for all existing concepts
            const results = filteredConcepts.map(concept => {
                const normalizedText = this.normalizeText(concept.value);
                const similarity = this.calculateTextSimilarity(normalizedNewText, normalizedText);
                
                return {
                    ...concept,
                    similarity
                };
            });
            
            // Sort by similarity (highest first)
            results.sort((a, b) => b.similarity - a.similarity);
            
            // Return concepts above threshold
            return results.filter(result => result.similarity > this.similarityThreshold);
            
        } catch (error) {
            console.error('Error finding similar concepts:', error);
            throw error;
        }
    }

    // Simple text normalization function
    normalizeText(text) {
        // Convert to lowercase, remove accents, remove punctuation
        return text.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // Remove punctuation
            .replace(/\s+/g, " "); // Replace multiple spaces with a single space
    }
    
    // Simple Jaccard similarity for text comparison
    calculateTextSimilarity(text1, text2) {
        // Simple implementation of Jaccard similarity
        const words1 = new Set(text1.split(' '));
        const words2 = new Set(text2.split(' '));
        
        // Calculate intersection and union
        const intersection = new Set([...words1].filter(word => words2.has(word)));
        const union = new Set([...words1, ...words2]);
        
        // Calculate Jaccard similarity
        return intersection.size / union.size;
    }

    // Keeping this method for compatibility, but using our simpler approach
    calculateCosineSimilarity(embedding1, embedding2) {
        // Not used in the fallback approach
        return 0.5; // Default value
    }
});

// Create a global instance only once
window.conceptMatcher = ModuleWrapper.createInstance('conceptMatcher', 'ConceptMatcher');
