/**
 * PlacesService - Core Google Places API Integration
 * 
 * Purpose: Clean, focused service for Google Places API operations
 * 
 * Main Responsibilities:
 * - Google Places API authentication and initialization
 * - Nearby search with configurable parameters
 * - Place details retrieval with full field specification
 * - Text search for place name queries
 * - Geocoding for address resolution
 * - Rate limiting and error handling
 * 
 * Dependencies: Google Maps JavaScript API, PlacesCache
 */

const PlacesService = (function() {
    'use strict';
    
    /**
     * Google Places API wrapper with clean, promise-based interface
     */
    class PlacesServiceClass {
        constructor() {
            this.log = Logger.module('PlacesService');
            
            // Core API state
            this.apiKey = '';
            this.apiLoaded = false;
            this.placesService = null;
            this.geocoder = null;
            
            // Rate limiting
            this.lastApiCall = 0;
            this.minApiInterval = 100; // 100ms between calls
            this.requestCount = 0;
            
            // Error handling
            this.maxRetries = 3;
            this.retryDelay = 1000; // 1 second base delay
        }
        
        /**
         * Initialize the Google Places API
         * @param {string} apiKey - Google Places API key
         * @returns {Promise<boolean>} - Success status
         */
        async initialize(apiKey) {
            if (!apiKey || apiKey.trim() === '') {
                throw new Error('API key is required');
            }
            
            this.apiKey = apiKey;
            
            try {
                // Load Google Maps API if not already loaded
                if (!window.google || !window.google.maps) {
                    await this.loadGoogleMapsAPI();
                }
                
                // Initialize services
                await this.initializeServices();
                
                this.apiLoaded = true;
                this.log.info('Places API initialized successfully');
                return true;
            } catch (error) {
                this.log.error('Failed to initialize Places API:', error);
                throw error;
            }
        }
        
        /**
         * Load Google Maps JavaScript API
         * @returns {Promise<void>}
         */
        async loadGoogleMapsAPI() {
            return new Promise((resolve, reject) => {
                if (window.google && window.google.maps) {
                    resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places`;
                script.async = true;
                script.defer = true;
                
                script.onload = () => {
                    this.log.info('Google Maps API loaded');
                    resolve();
                };
                
                script.onerror = () => {
                    reject(new Error('Failed to load Google Maps API'));
                };
                
                document.head.appendChild(script);
            });
        }
        
        /**
         * Initialize Google Places services
         * @returns {Promise<void>}
         */
        async initializeServices() {
            // Create hidden map div (required by PlacesService)
            let mapDiv = document.getElementById('places-service-map');
            if (!mapDiv) {
                mapDiv = document.createElement('div');
                mapDiv.id = 'places-service-map';
                mapDiv.style.cssText = 'height:0;width:0;position:absolute;left:-9999px;';
                document.body.appendChild(mapDiv);
            }
            
            // Create map instance
            const map = new google.maps.Map(mapDiv, {
                center: { lat: 0, lng: 0 },
                zoom: 1
            });
            
            // Initialize services
            this.placesService = new google.maps.places.PlacesService(map);
            this.geocoder = new google.maps.Geocoder();
            
            this.log.info('Places and Geocoder services initialized');
        }
        
        /**
         * Search for nearby places
         * @param {Object} params - Search parameters
         * @param {number} params.latitude - Center latitude
         * @param {number} params.longitude - Center longitude
         * @param {number} params.radius - Search radius in meters (default: 5000)
         * @param {string} params.type - Place type filter (e.g., 'restaurant')
         * @param {string} params.keyword - Optional keyword filter
         * @returns {Promise<Array>} - Array of place objects
         */
        async searchNearby({ latitude, longitude, radius = 5000, type = 'restaurant', keyword = null }) {
            this.ensureInitialized();
            await this.respectRateLimit();
            
            const request = {
                location: new google.maps.LatLng(latitude, longitude),
                radius: radius,
                type: type
            };
            
            if (keyword) {
                request.keyword = keyword;
            }
            
            this.log.debug('Nearby search:', request);
            
            return this.promisifyPlacesCall('nearbySearch', request);
        }
        
        /**
         * Search for places by text query
         * @param {Object} params - Search parameters
         * @param {string} params.query - Text search query
         * @param {number} params.latitude - Optional center latitude
         * @param {number} params.longitude - Optional center longitude
         * @param {number} params.radius - Optional search radius in meters
         * @returns {Promise<Array>} - Array of place objects
         */
        async searchByText({ query, latitude = null, longitude = null, radius = null }) {
            this.ensureInitialized();
            await this.respectRateLimit();
            
            const request = { query };
            
            if (latitude && longitude) {
                request.location = new google.maps.LatLng(latitude, longitude);
                if (radius) {
                    request.radius = radius;
                }
            }
            
            this.log.debug('Text search:', request);
            
            return this.promisifyPlacesCall('textSearch', request);
        }
        
        /**
         * Get detailed information about a place
         * @param {string} placeId - Google Place ID
         * @param {Array<string>} fields - Fields to retrieve (optional, defaults to all)
         * @returns {Promise<Object>} - Place details object
         */
        async getPlaceDetails(placeId, fields = null) {
            this.ensureInitialized();
            await this.respectRateLimit();
            
            const request = {
                placeId: placeId,
                fields: fields || [
                    'place_id',
                    'name',
                    'formatted_address',
                    'geometry',
                    'rating',
                    'user_ratings_total',
                    'types',
                    'price_level',
                    'opening_hours',
                    'formatted_phone_number',
                    'website',
                    'reviews',
                    'photos',
                    'vicinity'
                ]
            };
            
            this.log.debug('Getting place details:', placeId);
            
            return this.promisifyPlacesCall('getDetails', request);
        }
        
        /**
         * Geocode an address to coordinates
         * @param {string} address - Address to geocode
         * @returns {Promise<Object>} - Location object with lat, lng
         */
        async geocodeAddress(address) {
            this.ensureInitialized();
            await this.respectRateLimit();
            
            return new Promise((resolve, reject) => {
                this.geocoder.geocode({ address }, (results, status) => {
                    if (status === 'OK' && results && results.length > 0) {
                        const location = results[0].geometry.location;
                        resolve({
                            latitude: location.lat(),
                            longitude: location.lng(),
                            formatted_address: results[0].formatted_address
                        });
                    } else {
                        reject(new Error(`Geocoding failed: ${status}`));
                    }
                });
            });
        }
        
        /**
         * Convert Places API call to Promise
         * @param {string} method - PlacesService method name
         * @param {Object} request - Request parameters
         * @returns {Promise<Array|Object>} - API response
         */
        promisifyPlacesCall(method, request) {
            return new Promise((resolve, reject) => {
                this.requestCount++;
                
                this.placesService[method](request, (results, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK) {
                        resolve(results);
                    } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                        resolve([]);
                    } else {
                        const error = this.createErrorFromStatus(status);
                        this.log.error(`${method} failed:`, status);
                        reject(error);
                    }
                });
            });
        }
        
        /**
         * Enforce rate limiting between API calls
         * @returns {Promise<void>}
         */
        async respectRateLimit() {
            const now = Date.now();
            const timeSinceLastCall = now - this.lastApiCall;
            
            if (timeSinceLastCall < this.minApiInterval) {
                const delay = this.minApiInterval - timeSinceLastCall;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            this.lastApiCall = Date.now();
        }
        
        /**
         * Ensure API is initialized before making calls
         * @throws {Error} If API not initialized
         */
        ensureInitialized() {
            if (!this.apiLoaded || !this.placesService) {
                throw new Error('Places API not initialized. Call initialize() first.');
            }
        }
        
        /**
         * Create error from Google Places API status
         * @param {string} status - Places API status code
         * @returns {Error} - Error object
         */
        createErrorFromStatus(status) {
            const errorMessages = {
                [google.maps.places.PlacesServiceStatus.INVALID_REQUEST]: 'Invalid request parameters',
                [google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT]: 'API quota exceeded',
                [google.maps.places.PlacesServiceStatus.REQUEST_DENIED]: 'Request denied - check API key',
                [google.maps.places.PlacesServiceStatus.UNKNOWN_ERROR]: 'Server error - please retry',
                [google.maps.places.PlacesServiceStatus.NOT_FOUND]: 'Place not found'
            };
            
            const message = errorMessages[status] || `Unknown error: ${status}`;
            const error = new Error(message);
            error.status = status;
            return error;
        }
        
        /**
         * Get API usage statistics
         * @returns {Object} - Usage stats
         */
        getStats() {
            return {
                requestCount: this.requestCount,
                apiLoaded: this.apiLoaded,
                hasApiKey: !!this.apiKey
            };
        }
        
        /**
         * Reset API usage statistics
         */
        resetStats() {
            this.requestCount = 0;
            this.log.info('Stats reset');
        }
    }
    
    // Create and return singleton instance
    return new PlacesServiceClass();
})();

// Attach to window for global access
if (typeof window !== 'undefined') {
    window.PlacesService = PlacesService;
}
