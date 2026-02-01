/**
 * Concept Validation Service - Validates and detects duplicate concepts
 * 
 * Purpose: Centralized validation logic for restaurant concepts
 * 
 * Main Responsibilities:
 * - Validate concept data structure
 * - Detect duplicate concepts
 * - Normalize concept values
 * - Calculate concept similarity
 * 
 * Dependencies: None (pure validation logic)
 */

class ConceptValidationService {
    constructor() {
        this.log = Logger.module('ConceptValidationService');
        
        // Category name mapping: API format -> UI format
        this.categoryMap = {
            'cuisine': 'Cuisine',
            'menu': 'Menu',
            'price_range': 'Price Range',
            'mood': 'Mood',
            'setting': 'Setting',
            'crowd': 'Crowd',
            'suitable_for': 'Suitable For',
            'food_style': 'Food Style',
            'drinks': 'Drinks',
            'special_features': 'Special Features',
            'covid_specials': 'Special Features',
            'price_and_payment': 'Price Range'
        };
        
        // Valid categories
        this.validCategories = Object.values(this.categoryMap);
    }
    
    /**
     * Normalize category name from API format to UI format
     * @param {string} apiCategory - Category from API (e.g., 'food_style')
     * @returns {string} - Normalized category (e.g., 'Food Style')
     */
    normalizeCategoryName(apiCategory) {
        const normalized = this.categoryMap[apiCategory.toLowerCase()];
        if (normalized) {
            return normalized;
        }
        
        // Fallback: capitalize first letter of each word
        return apiCategory.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }
    
    /**
     * Normalize concept value for comparison
     * @param {string} value - Concept value
     * @returns {string} - Normalized value
     */
    normalizeValue(value) {
        if (!value) return '';
        
        return value
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, '') // Remove special characters
            .replace(/\s+/g, ' ');    // Normalize whitespace
    }
    
    /**
     * Check if concept is duplicate
     * @param {Array} existingConcepts - Array of existing concepts
     * @param {string} category - Concept category
     * @param {string} value - Concept value
     * @returns {boolean} - Whether concept is duplicate
     */
    isDuplicate(existingConcepts, category, value) {
        if (!existingConcepts || !Array.isArray(existingConcepts)) {
            return false;
        }
        
        const normalizedCategory = this.normalizeCategoryName(category);
        const normalizedValue = this.normalizeValue(value);
        
        return existingConcepts.some(concept => {
            const conceptCategory = this.normalizeCategoryName(concept.category);
            const conceptValue = this.normalizeValue(concept.value);
            
            return conceptCategory === normalizedCategory && 
                   conceptValue === normalizedValue;
        });
    }
    
    /**
     * Calculate similarity between two strings (0-1)
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Similarity score (0-1)
     */
    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        const normalized1 = this.normalizeValue(str1);
        const normalized2 = this.normalizeValue(str2);
        
        // Exact match
        if (normalized1 === normalized2) return 1;
        
        // Contains match
        if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
            return 0.8;
        }
        
        // Levenshtein distance for fuzzy matching
        const distance = this.levenshteinDistance(normalized1, normalized2);
        const maxLength = Math.max(normalized1.length, normalized2.length);
        
        return 1 - (distance / maxLength);
    }
    
    /**
     * Find most similar concept
     * @param {Array} existingConcepts - Existing concepts
     * @param {string} category - Target category
     * @param {string} value - Target value
     * @param {number} threshold - Minimum similarity (0-1)
     * @returns {Object|null} - Most similar concept or null
     */
    findMostSimilar(existingConcepts, category, value, threshold = 0.7) {
        if (!existingConcepts || !Array.isArray(existingConcepts)) {
            return null;
        }
        
        const normalizedCategory = this.normalizeCategoryName(category);
        
        let mostSimilar = null;
        let highestScore = threshold;
        
        existingConcepts.forEach(concept => {
            const conceptCategory = this.normalizeCategoryName(concept.category);
            
            // Only compare within same category
            if (conceptCategory === normalizedCategory) {
                const score = this.calculateSimilarity(value, concept.value);
                
                if (score > highestScore) {
                    highestScore = score;
                    mostSimilar = {
                        ...concept,
                        similarity: score
                    };
                }
            }
        });
        
        return mostSimilar;
    }
    
    /**
     * Validate concept data structure
     * @param {Object} concept - Concept to validate
     * @returns {Object} - { valid: boolean, errors: Array }
     */
    validate(concept) {
        const errors = [];
        
        if (!concept) {
            errors.push('Concept is required');
            return { valid: false, errors };
        }
        
        if (!concept.category) {
            errors.push('Category is required');
        }
        
        if (!concept.value) {
            errors.push('Value is required');
        }
        
        if (concept.category && !this.validCategories.includes(concept.category)) {
            const normalized = this.normalizeCategoryName(concept.category);
            if (!this.validCategories.includes(normalized)) {
                errors.push(`Invalid category: ${concept.category}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Validate batch of concepts
     * @param {Array} concepts - Concepts to validate
     * @returns {Object} - { valid: boolean, errors: Array, validConcepts: Array }
     */
    validateBatch(concepts) {
        if (!Array.isArray(concepts)) {
            return {
                valid: false,
                errors: ['Concepts must be an array'],
                validConcepts: []
            };
        }
        
        const results = concepts.map((concept, index) => ({
            index,
            concept,
            ...this.validate(concept)
        }));
        
        const errors = results
            .filter(r => !r.valid)
            .map(r => `Concept ${r.index}: ${r.errors.join(', ')}`);
        
        const validConcepts = results
            .filter(r => r.valid)
            .map(r => r.concept);
        
        return {
            valid: errors.length === 0,
            errors,
            validConcepts
        };
    }
    
    /**
     * Levenshtein distance algorithm
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    /**
     * Get category mapping
     * @returns {Object} - Category map
     */
    getCategoryMap() {
        return { ...this.categoryMap };
    }
    
    /**
     * Get valid categories
     * @returns {Array} - Valid category names
     */
    getValidCategories() {
        return [...this.validCategories];
    }
}

window.ConceptValidationService = ConceptValidationService;
console.debug('[ConceptValidationService] Service initialized');
