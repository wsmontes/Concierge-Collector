/**
 * ConceptMatcher module for computing similarity between concepts
 * Responsibilities:
 *   - Calculate similarity scores between two concept strings
 *   - Provide utility to find the most similar existing concepts
 * Dependencies:
 *   - None (pure JS utility)
 */
if (typeof window.ConceptMatcher === 'undefined') {
    /**
     * Handles concept matching using text similarity (fallback approach)
     */

    // Only define the class if it doesn't already exist
    const ConceptMatcher = ModuleWrapper.defineClass('ConceptMatcher', class {
        constructor() {
            this.similarityThreshold = 0.7; // Default similarity threshold
            this.modelLoaded = true; // Always "loaded" with our fallback
            
            // Define common words to ignore in similarity calculations
            this.stopWords = new Set([
                'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with',
                'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between',
                'out', 'of', 'from', 'up', 'down', 'is', 'are', 'was', 'were', 'be', 'been',
                'being', 'have', 'has', 'had', 'do', 'does', 'did'
            ]);
        }

        async loadModel() {
            // Since we're using a simplified matching approach, just log a notification
            console.log("Using enhanced text similarity matching for concepts");
            
            // Show notification to user
            if (typeof Toastify === 'function') {
                Toastify({
                    text: "Using enhanced concept matching",
                    duration: 3000,
                    gravity: "bottom",
                    position: "center",
                    style: { 
                        background: "linear-gradient(to right, #4b6cb7, #182848)",
                        color: "#ffffff" 
                    }
                }).showToast();
            }
            
            return true;
        }

        setSimilarityThreshold(threshold) {
            const validThreshold = Math.max(0, Math.min(1, threshold));
            this.similarityThreshold = validThreshold;
            console.log(`Similarity threshold set to: ${validThreshold}`);
            return validThreshold;
        }

        async getEmbedding(text) {
            // Instead of embeddings, we'll normalize the text and remove stop words
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
                const newTokens = this.tokenizeAndFilter(normalizedNewText);
                
                // Calculate similarity for all existing concepts using multiple methods
                const results = filteredConcepts.map(concept => {
                    const normalizedText = this.normalizeText(concept.value);
                    const existingTokens = this.tokenizeAndFilter(normalizedText);
                    
                    // Use multiple similarity measures and take the highest score
                    const jaccardSim = this.calculateJaccardSimilarity(newTokens, existingTokens);
                    const editDistSim = this.calculateEditDistanceSimilarity(normalizedNewText, normalizedText);
                    const overlapSim = this.calculateOverlapCoefficient(newTokens, existingTokens);
                    
                    // Take the highest similarity score from the methods
                    const similarity = Math.max(jaccardSim, editDistSim, overlapSim);
                    
                    return {
                        ...concept,
                        similarity,
                        // Include individual scores for debugging
                        _debug: {
                            jaccardSim,
                            editDistSim,
                            overlapSim
                        }
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

        // Text normalization function with improved handling
        normalizeText(text) {
            if (!text || typeof text !== 'string') return '';
            
            return text.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ") // Replace punctuation with spaces
                .replace(/\s+/g, " ") // Replace multiple spaces with a single space
                .trim(); // Remove leading/trailing spaces
        }
        
        // Tokenize text and filter stop words
        tokenizeAndFilter(text) {
            const tokens = text.split(' ').filter(token => token.length > 0);
            return tokens.filter(token => !this.stopWords.has(token));
        }
        
        // Jaccard similarity - good for finding shared words regardless of order
        calculateJaccardSimilarity(tokens1, tokens2) {
            const set1 = new Set(tokens1);
            const set2 = new Set(tokens2);
            
            // Handle empty sets to avoid division by zero
            if (set1.size === 0 && set2.size === 0) return 1.0;
            if (set1.size === 0 || set2.size === 0) return 0.0;
            
            // Calculate intersection and union
            const intersection = new Set([...set1].filter(word => set2.has(word)));
            const union = new Set([...set1, ...set2]);
            
            // Calculate Jaccard similarity
            return intersection.size / union.size;
        }
        
        // Overlap coefficient - good for handling subsets
        calculateOverlapCoefficient(tokens1, tokens2) {
            const set1 = new Set(tokens1);
            const set2 = new Set(tokens2);
            
            // Handle empty sets
            if (set1.size === 0 || set2.size === 0) return 0.0;
            
            // Calculate intersection
            const intersection = new Set([...set1].filter(word => set2.has(word)));
            
            // Overlap coefficient is the size of intersection divided by size of smaller set
            return intersection.size / Math.min(set1.size, set2.size);
        }
        
        // Edit distance similarity - good for typos and small variations
        calculateEditDistanceSimilarity(str1, str2) {
            // Levenshtein distance calculation
            const m = str1.length;
            const n = str2.length;
            
            // Handle empty strings
            if (m === 0) return n === 0 ? 1.0 : 0.0;
            if (n === 0) return 0.0;
            
            // Create distance matrix
            const distance = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
            
            // Initialize first row and column
            for (let i = 0; i <= m; i++) distance[i][0] = i;
            for (let j = 0; j <= n; j++) distance[0][j] = j;
            
            // Fill the distance matrix
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    distance[i][j] = Math.min(
                        distance[i - 1][j] + 1,          // deletion
                        distance[i][j - 1] + 1,          // insertion
                        distance[i - 1][j - 1] + cost    // substitution
                    );
                }
            }
            
            // Convert edit distance to similarity score
            const maxDistance = Math.max(m, n);
            return 1 - (distance[m][n] / maxDistance);
        }

        // Keeping this method for compatibility, but using our simpler approach
        calculateCosineSimilarity(embedding1, embedding2) {
            // Not used in the fallback approach
            return 0.5; // Default value
        }
    });

    // Create a global instance only once
    window.conceptMatcher = ModuleWrapper.createInstance('conceptMatcher', 'ConceptMatcher');
} else {
    console.warn('ConceptMatcher already defined, skipping redefinition');
}
