/**
 * File: PlacesOrchestrationService.js
 * Purpose: Unified Google Places API service using the orchestration endpoint
 * Dependencies: Logger, AppConfig
 * Last Updated: November 21, 2025
 *
 * This service provides a clean interface to the Places API orchestration endpoint.
 * All Google Places operations (nearby, text search, details, bulk) are handled
 * through a single unified API call with intelligent operation detection.
 *
 * Replaces direct Google Maps JavaScript API calls with backend API calls for:
 * - Better rate limiting control
 * - Centralized API key management
 * - Consistent error handling
 * - Bulk operation support
 * - Response caching
 */

const PlacesOrchestrationService = (function () {
    'use strict';

    class PlacesOrchestrationServiceClass {
        constructor() {
            this.log = Logger.module('PlacesOrchestration');

            // Get base URL from config or default
            // AppConfig.api.backend.baseUrl usually includes /api/v3 (e.g., http://localhost:8000/api/v3)
            const configBaseUrl = window.AppConfig?.api?.backend?.baseUrl;

            if (configBaseUrl) {
                // Remove trailing slash if present
                const cleanBase = configBaseUrl.replace(/\/$/, '');
                // If config already has /api/v3, do not append it again
                // The endpoint is /places/orchestrate relative to the API base
                this.orchestrateEndpoint = `${cleanBase}/places/orchestrate`;
            } else {
                // Fallback default
                this.orchestrateEndpoint = 'http://localhost:8000/api/v3/places/orchestrate';
            }

            this.log.debug('Initialized with endpoint:', this.orchestrateEndpoint);

            // Request tracking
            this.requestCount = 0;
            this.errorCount = 0;
            this.cacheHits = 0;

            // Simple in-memory cache
            this.cache = new Map();
            this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        }

        /**
         * Search for places nearby a location
         * @param {Object} params - Search parameters
         * @param {number} params.latitude - Center latitude
         * @param {number} params.longitude - Center longitude
         * @param {number} params.radius - Search radius in meters (default: 500)
         * @param {Array<string>} params.types - Place types (e.g., ['restaurant', 'cafe'])
         * @param {number} params.maxResults - Maximum results (default: 20)
         * @param {number} params.minRating - Minimum rating filter (optional)
         * @param {boolean} params.openNow - Only open places (optional)
         * @returns {Promise<Array>} - Array of places
         */
        async searchNearby(params) {
            const request = {
                latitude: params.latitude,
                longitude: params.longitude,
                radius: params.radius || 500,
                max_results: params.maxResults || 20
            };

            if (params.types && params.types.length > 0) {
                request.included_types = params.types;
            }

            if (params.minRating) {
                request.min_rating = params.minRating;
            }

            if (params.openNow !== undefined) {
                request.open_now = params.openNow;
            }

            this.log.debug('Nearby search:', request);
            return this.orchestrate(request);
        }

        /**
         * Search for places by text query
         * @param {Object} params - Search parameters
         * @param {string} params.query - Text search query
         * @param {number} params.latitude - Optional center latitude for bias
         * @param {number} params.longitude - Optional center longitude for bias
         * @param {number} params.radius - Optional radius for location bias
         * @param {number} params.maxResults - Maximum results (default: 20)
         * @param {Array<string>} params.types - Optional place types filter
         * @returns {Promise<Array>} - Array of places
         */
        async searchByText(params) {
            const request = {
                query: params.query,
                max_results: params.maxResults || 20
            };

            if (params.latitude && params.longitude) {
                request.latitude = params.latitude;
                request.longitude = params.longitude;
                request.radius = params.radius || 1000;
            }

            if (params.types && params.types.length > 0) {
                request.included_types = params.types;
            }

            this.log.debug('Text search:', request);
            return this.orchestrate(request);
        }

        /**
         * Get detailed information about a place
         * @param {string} placeId - Google Place ID
         * @returns {Promise<Object>} - Place details
         */
        async getPlaceDetails(placeId) {
            const request = { place_id: placeId };

            this.log.debug('Place details:', placeId);
            const response = await this.orchestrate(request);

            // Details returns array with single item, extract it
            return response.results && response.results.length > 0
                ? response.results[0]
                : null;
        }

        /**
         * Get details for multiple places in bulk
         * @param {Array<string>} placeIds - Array of Google Place IDs
         * @returns {Promise<Array>} - Array of place details
         */
        async getBulkDetails(placeIds) {
            if (!placeIds || placeIds.length === 0) {
                return [];
            }

            const request = { place_ids: placeIds };

            this.log.debug('Bulk details:', placeIds.length, 'places');
            return this.orchestrate(request);
        }

        /**
         * Execute multiple operations in one request
         * @param {Array<Object>} operations - Array of operation configs
         * @param {Object} sharedParams - Shared parameters for all operations
         * @returns {Promise<Array>} - Combined results from all operations
         */
        async multiOperation(operations, sharedParams = {}) {
            if (!operations || operations.length === 0) {
                return [];
            }

            const request = {
                operations: operations,
                ...sharedParams
            };

            this.log.debug('Multi-operation:', operations.length, 'operations');
            return this.orchestrate(request);
        }

        /**
         * Main orchestration method - calls the unified endpoint
         * @param {Object} request - Request parameters
         * @returns {Promise<Object>} - Orchestration response with results
         */
        async orchestrate(request) {
            // Check cache first
            const cacheKey = this.getCacheKey(request);
            const cached = this.getFromCache(cacheKey);

            if (cached) {
                this.cacheHits++;
                this.log.debug('Cache hit:', cacheKey);
                return cached;
            }

            // Make API call
            try {
                this.requestCount++;

                const response = await fetch(this.orchestrateEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error ${response.status}: ${errorText}`);
                }

                const data = await response.json();

                this.log.debug(`Operation: ${data.operation}, Results: ${data.total_results}`);

                // Cache successful response
                this.setCache(cacheKey, data);

                return data;

            } catch (error) {
                this.errorCount++;
                this.log.error('Orchestration error:', error);
                throw error;
            }
        }

        /**
         * Transform modern API response to legacy format for backwards compatibility
         * @param {Array} places - Places from orchestration API
         * @returns {Array} - Legacy formatted places
         */
        toLegacyFormat(places) {
            if (!places || !Array.isArray(places)) {
                return [];
            }

            return places.map(place => ({
                place_id: place.id,
                name: place.displayName?.text || 'Unknown',
                geometry: {
                    location: {
                        lat: () => place.location?.latitude,
                        lng: () => place.location?.longitude
                    }
                },
                formatted_address: place.formattedAddress,
                vicinity: place.formattedAddress,
                types: place.types || [],
                photos: place.photos || [],
                rating: place.rating,
                user_ratings_total: place.userRatingCount,
                price_level: this.convertPriceLevel(place.priceLevel),
                opening_hours: place.regularOpeningHours,
                website: place.websiteUri,
                formatted_phone_number: place.nationalPhoneNumber,
                international_phone_number: place.internationalPhoneNumber
            }));
        }

        /**
         * Convert new API price level to legacy numeric format
         * @param {string} priceLevel - New API format (e.g., "PRICE_LEVEL_MODERATE")
         * @returns {number} - Legacy format (0-4)
         */
        convertPriceLevel(priceLevel) {
            const mapping = {
                'PRICE_LEVEL_FREE': 0,
                'PRICE_LEVEL_INEXPENSIVE': 1,
                'PRICE_LEVEL_MODERATE': 2,
                'PRICE_LEVEL_EXPENSIVE': 3,
                'PRICE_LEVEL_VERY_EXPENSIVE': 4
            };
            return mapping[priceLevel] !== undefined ? mapping[priceLevel] : null;
        }

        /**
         * Generate cache key from request
         * @param {Object} request - Request object
         * @returns {string} - Cache key
         */
        getCacheKey(request) {
            return JSON.stringify(request);
        }

        /**
         * Get cached response
         * @param {string} key - Cache key
         * @returns {Object|null} - Cached response or null
         */
        getFromCache(key) {
            const cached = this.cache.get(key);
            if (!cached) {
                return null;
            }

            // Check if expired
            if (Date.now() - cached.timestamp > this.cacheTTL) {
                this.cache.delete(key);
                return null;
            }

            return cached.data;
        }

        /**
         * Store response in cache
         * @param {string} key - Cache key
         * @param {Object} data - Response data
         */
        setCache(key, data) {
            // Limit cache size
            if (this.cache.size > 100) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }

            this.cache.set(key, {
                data: data,
                timestamp: Date.now()
            });
        }

        /**
         * Clear all cache
         */
        clearCache() {
            this.cache.clear();
            this.log.debug('Cache cleared');
        }

        /**
         * Get performance metrics
         * @returns {Object} - Metrics object
         */
        getMetrics() {
            return {
                requests: this.requestCount,
                errors: this.errorCount,
                cacheHits: this.cacheHits,
                cacheSize: this.cache.size,
                cacheHitRate: this.requestCount > 0
                    ? ((this.cacheHits / (this.requestCount + this.cacheHits)) * 100).toFixed(2) + '%'
                    : '0%'
            };
        }

        /**
         * Log current metrics
         */
        logMetrics() {
            const metrics = this.getMetrics();
            this.log.info('Performance Metrics:', metrics);
        }
    }

    // Create singleton instance
    const instance = new PlacesOrchestrationServiceClass();

    // Expose globally
    window.PlacesOrchestrationService = instance;

    return instance;
})();
