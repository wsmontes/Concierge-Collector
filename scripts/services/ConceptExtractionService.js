/**
 * Concept Extraction Service - Extracts concepts from text and images
 * 
 * Purpose: AI-powered concept extraction and analysis
 * 
 * Main Responsibilities:
 * - Extract concepts from transcription text
 * - Extract concepts from image analysis
 * - Categorize extracted concepts
 * - Merge and deduplicate concepts
 * 
 * Dependencies: apiUtils, ConceptValidationService
 */

class ConceptExtractionService {
    constructor() {
        this.log = Logger.module('ConceptExtractionService');
        
        // Validate dependencies
        if (!window.apiUtils) {
            throw new Error('apiUtils not loaded');
        }
        
        if (!window.ConceptValidationService) {
            throw new Error('ConceptValidationService not loaded');
        }
        
        this.validationService = new ConceptValidationService();
    }
    
    /**
     * Extract concepts from transcription text
     * @param {string} transcription - Transcription text
     * @param {Object} options - Extraction options
     * @returns {Promise<Array>} - Extracted concepts
     */
    async extractFromTranscription(transcription, options = {}) {
        this.log.debug('Extracting concepts from transcription', {
            length: transcription?.length || 0
        });
        
        if (!transcription || !transcription.trim()) {
            return [];
        }
        
        try {
            const response = await window.apiUtils.callAPI('/ai/extract-concepts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: transcription,
                    options: {
                        maxConcepts: options.maxConcepts || 20,
                        includeCategories: options.includeCategories || null
                    }
                })
            });
            
            if (!response.ok) {
                throw new Error(`Concept extraction failed: ${response.statusText}`);
            }
            
            const data = await response.json();
            const concepts = data.concepts || [];
            
            this.log.debug(`Extracted ${concepts.length} concepts from transcription`);
            
            return this.normalizeConcepts(concepts);
            
        } catch (error) {
            this.log.error('Transcription concept extraction failed:', error);
            throw error;
        }
    }
    
    /**
     * Extract concepts from image analysis result
     * @param {Object} imageAnalysis - Image analysis result
     * @returns {Array} - Extracted concepts
     */
    extractFromImageAnalysis(imageAnalysis) {
        this.log.debug('Extracting concepts from image analysis');
        
        if (!imageAnalysis || !imageAnalysis.concepts) {
            return [];
        }
        
        const concepts = imageAnalysis.concepts.map(concept => ({
            category: this.validationService.normalizeCategoryName(concept.category || 'Special Features'),
            value: concept.value || concept.label || concept.name,
            confidence: concept.confidence || 1.0,
            source: 'image'
        }));
        
        this.log.debug(`Extracted ${concepts.length} concepts from image`);
        
        return this.normalizeConcepts(concepts);
    }
    
    /**
     * Extract concepts from restaurant analysis
     * @param {Object} analysis - Restaurant analysis result
     * @returns {Array} - Extracted concepts
     */
    extractFromAnalysis(analysis) {
        this.log.debug('Extracting concepts from analysis');
        
        const concepts = [];
        
        // Extract from different analysis fields
        if (analysis.concepts && Array.isArray(analysis.concepts)) {
            concepts.push(...analysis.concepts);
        }
        
        if (analysis.cuisine) {
            concepts.push({
                category: 'Cuisine',
                value: analysis.cuisine
            });
        }
        
        if (analysis.priceRange) {
            concepts.push({
                category: 'Price Range',
                value: analysis.priceRange
            });
        }
        
        if (analysis.mood && Array.isArray(analysis.mood)) {
            analysis.mood.forEach(m => {
                concepts.push({
                    category: 'Mood',
                    value: m
                });
            });
        }
        
        if (analysis.features && Array.isArray(analysis.features)) {
            analysis.features.forEach(f => {
                concepts.push({
                    category: 'Special Features',
                    value: f
                });
            });
        }
        
        this.log.debug(`Extracted ${concepts.length} concepts from analysis`);
        
        return this.normalizeConcepts(concepts);
    }
    
    /**
     * Normalize concepts (category names, deduplication)
     * @param {Array} concepts - Concepts to normalize
     * @returns {Array} - Normalized concepts
     */
    normalizeConcepts(concepts) {
        if (!concepts || !Array.isArray(concepts)) {
            return [];
        }
        
        const normalized = concepts.map(concept => ({
            category: this.validationService.normalizeCategoryName(concept.category),
            value: concept.value?.trim() || '',
            confidence: concept.confidence || 1.0,
            source: concept.source || 'unknown'
        }));
        
        // Filter out invalid
        const valid = normalized.filter(c => c.category && c.value);
        
        // Deduplicate
        const unique = this.deduplicateConcepts(valid);
        
        return unique;
    }
    
    /**
     * Deduplicate concepts
     * @param {Array} concepts - Concepts to deduplicate
     * @returns {Array} - Deduplicated concepts
     */
    deduplicateConcepts(concepts) {
        const seen = new Set();
        const unique = [];
        
        concepts.forEach(concept => {
            const key = `${concept.category}:${this.validationService.normalizeValue(concept.value)}`;
            
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(concept);
            }
        });
        
        this.log.debug(`Deduplicated: ${concepts.length} → ${unique.length} concepts`);
        
        return unique;
    }
    
    /**
     * Merge new concepts with existing
     * @param {Array} existingConcepts - Existing concepts
     * @param {Array} newConcepts - New concepts to merge
     * @param {Object} options - Merge options
     * @returns {Object} - { merged: Array, added: Array, skipped: Array }
     */
    mergeConcepts(existingConcepts, newConcepts, options = {}) {
        this.log.debug('Merging concepts', {
            existing: existingConcepts?.length || 0,
            new: newConcepts?.length || 0
        });
        
        const merged = [...existingConcepts];
        const added = [];
        const skipped = [];
        
        newConcepts.forEach(newConcept => {
            const isDuplicate = this.validationService.isDuplicate(
                merged,
                newConcept.category,
                newConcept.value
            );
            
            if (isDuplicate) {
                skipped.push(newConcept);
            } else {
                // Check similarity if enabled
                if (options.checkSimilarity) {
                    const similar = this.validationService.findMostSimilar(
                        merged,
                        newConcept.category,
                        newConcept.value,
                        options.similarityThreshold || 0.8
                    );
                    
                    if (similar) {
                        skipped.push({
                            ...newConcept,
                            reason: 'similar',
                            similarTo: similar
                        });
                        return;
                    }
                }
                
                merged.push(newConcept);
                added.push(newConcept);
            }
        });
        
        this.log.debug('Merge complete', {
            total: merged.length,
            added: added.length,
            skipped: skipped.length
        });
        
        return { merged, added, skipped };
    }
    
    /**
     * Batch extract concepts from multiple sources
     * @param {Object} sources - Sources object { transcription, images, analysis }
     * @param {Object} options - Extraction options
     * @returns {Promise<Array>} - All extracted concepts
     */
    async batchExtract(sources, options = {}) {
        this.log.debug('Batch extracting from multiple sources');
        
        const results = [];
        
        // Extract from transcription
        if (sources.transcription) {
            try {
                const concepts = await this.extractFromTranscription(
                    sources.transcription,
                    options
                );
                results.push(...concepts);
            } catch (error) {
                this.log.error('Transcription extraction failed:', error);
            }
        }
        
        // Extract from images
        if (sources.images && Array.isArray(sources.images)) {
            sources.images.forEach(imageAnalysis => {
                const concepts = this.extractFromImageAnalysis(imageAnalysis);
                results.push(...concepts);
            });
        }
        
        // Extract from analysis
        if (sources.analysis) {
            const concepts = this.extractFromAnalysis(sources.analysis);
            results.push(...concepts);
        }
        
        // Deduplicate all results
        const unique = this.deduplicateConcepts(results);
        
        this.log.debug(`Batch extraction complete: ${unique.length} unique concepts`);
        
        return unique;
    }
    
    /**
     * Get concept statistics
     * @param {Array} concepts - Concepts to analyze
     * @returns {Object} - Statistics
     */
    getStatistics(concepts) {
        if (!concepts || !Array.isArray(concepts)) {
            return {
                total: 0,
                byCategory: {},
                bySource: {},
                avgConfidence: 0
            };
        }
        
        const byCategory = {};
        const bySource = {};
        let totalConfidence = 0;
        
        concepts.forEach(concept => {
            // By category
            byCategory[concept.category] = (byCategory[concept.category] || 0) + 1;
            
            // By source
            const source = concept.source || 'unknown';
            bySource[source] = (bySource[source] || 0) + 1;
            
            // Confidence
            totalConfidence += concept.confidence || 1.0;
        });
        
        return {
            total: concepts.length,
            byCategory,
            bySource,
            avgConfidence: concepts.length > 0 ? totalConfidence / concepts.length : 0
        };
    }
}

window.ConceptExtractionService = ConceptExtractionService;
console.debug('[ConceptExtractionService] Service initialized');
