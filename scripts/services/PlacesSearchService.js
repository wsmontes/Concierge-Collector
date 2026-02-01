/**
 * Places Search Service - Google Places API integration
 * 
 * Purpose: Centralized Google Places API search operations
 * 
 * Main Responsibilities:
 * - Execute nearby search
 * - Execute text search
 * - Get place details
 * - Handle API rate limiting
 * 
 * Dependencies: PlacesService (existing), apiUtils
 */

class PlacesSearchService {
    constructor() {
        this.log = Logger.module('PlacesSearchService');
        
        // Validate dependencies
        if (!window.PlacesService) {
            throw new Error('PlacesService not loaded');
        }
        
        this.placesService = window.PlacesService;
        
        // Rate limiting
        this.lastSearchTime = 0;
        this.minSearchInterval = 500; // 500ms between searches
        
        // Search statistics
        this.stats = {
            searches: 0,
            successful: 0,
            failed: 0,
            cached: 0
        };
    }
    
    /**
     * Search for places nearby
     * @param {Object} params - Search parameters
     * @returns {Promise<Array>} - Search results
     */
    async searchNearby(params) {
        this.log.debug('Searching nearby places', params);
        
        // Rate limit check
        await this.enforceRateLimit();
        
        this.stats.searches++;
        
        try {
            const results = await this.placesService.searchNearby({
                latitude: params.latitude,
                longitude: params.longitude,
                radius: params.radius || 5000,
                type: params.type || 'restaurant',
                keyword: params.keyword || ''
            });
            
            this.stats.successful++;
            this.log.debug(`Found ${results.length} places`);
            
            return results;
            
        } catch (error) {
            this.stats.failed++;
            this.log.error('Nearby search failed:', error);
            throw error;
        }
    }
    
    /**
     * Search for places by text query
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Search results
     */
    async searchByText(query, options = {}) {
        this.log.debug('Searching places by text', { query });
        
        // Rate limit check
        await this.enforceRateLimit();
        
        this.stats.searches++;
        
        try {
            const results = await this.placesService.searchByText(query, {
                location: options.location,
                radius: options.radius || 5000,
                type: options.type || 'restaurant'
            });
            
            this.stats.successful++;
            this.log.debug(`Found ${results.length} places`);
            
            return results;
            
        } catch (error) {
            this.stats.failed++;
            this.log.error('Text search failed:', error);
            throw error;
        }
    }
    
    /**
     * Get detailed information about a place
     * @param {string} placeId - Google Place ID
     * @returns {Promise<Object>} - Place details
     */
    async getPlaceDetails(placeId) {
        this.log.debug('Getting place details', { placeId });
        
        try {
            const details = await this.placesService.getPlaceDetails(placeId);
            
            this.log.debug('Place details retrieved', {
                name: details.name,
                hasPhotos: !!details.photos
            });
            
            return details;
            
        } catch (error) {
            this.log.error('Get place details failed:', error);
            throw error;
        }
    }
    
    /**
     * Search with autocomplete
     * @param {string} input - Search input
     * @param {Object} options - Autocomplete options
     * @returns {Promise<Array>} - Autocomplete predictions
     */
    async autocomplete(input, options = {}) {
        this.log.debug('Autocomplete search', { input });
        
        if (!input || input.length < 2) {
            return [];
        }
        
        try {
            const predictions = await this.placesService.autocomplete(input, {
                types: options.types || ['restaurant', 'cafe'],
                location: options.location,
                radius: options.radius || 5000
            });
            
            this.log.debug(`Found ${predictions.length} predictions`);
            
            return predictions;
            
        } catch (error) {
            this.log.error('Autocomplete failed:', error);
            return [];
        }
    }
    
    /**
     * Enforce rate limiting between searches
     */
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastSearch = now - this.lastSearchTime;
        
        if (timeSinceLastSearch < this.minSearchInterval) {
            const waitTime = this.minSearchInterval - timeSinceLastSearch;
            this.log.debug(`Rate limiting: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastSearchTime = Date.now();
    }
    
    /**
     * Filter results by criteria
     * @param {Array} results - Search results
     * @param {Object} filters - Filter criteria
     * @returns {Array} - Filtered results
     */
    filterResults(results, filters = {}) {
        let filtered = [...results];
        
        // Filter by type (food places only)
        if (filters.foodOnly) {
            filtered = filtered.filter(place => {
                const types = place.types || [];
                return types.some(type => 
                    ['restaurant', 'cafe', 'bar', 'food', 'meal_delivery', 'meal_takeaway']
                        .includes(type)
                );
            });
        }
        
        // Filter by price range
        if (filters.priceRange && filters.priceRange !== 'all') {
            const targetPrice = parseInt(filters.priceRange);
            filtered = filtered.filter(place => place.price_level === targetPrice);
        }
        
        // Filter by minimum rating
        if (filters.minRating && filters.minRating > 0) {
            filtered = filtered.filter(place => 
                place.rating && place.rating >= filters.minRating
            );
        }
        
        // Filter by cuisine type
        if (filters.cuisine && filters.cuisine !== 'all') {
            filtered = filtered.filter(place => {
                const types = place.types || [];
                return types.includes(filters.cuisine);
            });
        }
        
        this.log.debug(`Filtered: ${results.length} → ${filtered.length} results`);
        
        return filtered;
    }
    
    /**
     * Sort results by criteria
     * @param {Array} results - Results to sort
     * @param {string} sortBy - Sort criteria (distance, rating, price)
     * @param {Object} location - User location for distance sorting
     * @returns {Array} - Sorted results
     */
    sortResults(results, sortBy = 'distance', location = null) {
        const sorted = [...results];
        
        switch (sortBy) {
            case 'rating':
                sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
                
            case 'price':
                sorted.sort((a, b) => (a.price_level || 0) - (b.price_level || 0));
                break;
                
            case 'distance':
                if (location) {
                    sorted.sort((a, b) => {
                        const distA = this.calculateDistance(location, a.geometry?.location);
                        const distB = this.calculateDistance(location, b.geometry?.location);
                        return distA - distB;
                    });
                }
                break;
                
            default:
                this.log.warn('Unknown sort criteria:', sortBy);
        }
        
        return sorted;
    }
    
    /**
     * Calculate distance between two points (Haversine formula)
     * @param {Object} point1 - {lat, lng}
     * @param {Object} point2 - {lat, lng}
     * @returns {number} - Distance in meters
     */
    calculateDistance(point1, point2) {
        if (!point1 || !point2) return Infinity;
        
        const R = 6371e3; // Earth radius in meters
        const φ1 = point1.lat * Math.PI / 180;
        const φ2 = point2.lat * Math.PI / 180;
        const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
        const Δλ = (point2.lng - point1.lng) * Math.PI / 180;
        
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        return R * c;
    }
    
    /**
     * Get search statistics
     * @returns {Object}
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            searches: 0,
            successful: 0,
            failed: 0,
            cached: 0
        };
    }
}

window.PlacesSearchService = PlacesSearchService;
console.debug('[PlacesSearchService] Service initialized');
