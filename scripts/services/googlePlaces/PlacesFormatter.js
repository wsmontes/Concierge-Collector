/**
 * PlacesFormatter - Data Transformation for Google Places API
 * 
 * Purpose: Transform Google Places API responses into application-ready data structures
 * 
 * Main Responsibilities:
 * - Transform Places API results to entity format
 * - Extract concepts from place types and reviews
 * - Format photos for display and storage
 * - Normalize address and contact information
 * - Extract cuisine types and categories
 * 
 * Dependencies: None (standalone utility)
 */

const PlacesFormatter = (function() {
    'use strict';
    
    /**
     * Utility class for formatting Google Places API data
     */
    class PlacesFormatterClass {
        constructor() {
            this.log = Logger.module('PlacesFormatter');
            
            // Cuisine mapping from Google Place types
            this.cuisineMapping = {
                'chinese_restaurant': 'Chinese',
                'french_restaurant': 'French',
                'italian_restaurant': 'Italian',
                'japanese_restaurant': 'Japanese',
                'mexican_restaurant': 'Mexican',
                'thai_restaurant': 'Thai',
                'indian_restaurant': 'Indian',
                'greek_restaurant': 'Greek',
                'spanish_restaurant': 'Spanish',
                'vietnamese_restaurant': 'Vietnamese',
                'korean_restaurant': 'Korean',
                'american_restaurant': 'American',
                'brazilian_restaurant': 'Brazilian',
                'mediterranean_restaurant': 'Mediterranean'
            };
            
            // Types to exclude from display
            this.excludedTypes = [
                'point_of_interest',
                'establishment',
                'food',
                'store'
            ];
        }
        
        /**
         * Transform Google Place to Entity format
         * @param {Object} place - Google Places API result
         * @returns {Object} - Entity object ready for database
         */
        placeToEntity(place) {
            const entity = {
                name: place.name || 'Unknown',
                description: this.extractDescription(place),
                type: 'place',
                subtype: this.extractSubtype(place),
                metadata: []
            };
            
            // Add Google Places metadata
            entity.metadata.push({
                type: 'google_places',
                source: 'google_places_api',
                data: {
                    placeId: place.place_id,
                    rating: place.rating || null,
                    userRatingsTotal: place.user_ratings_total || null,
                    priceLevel: place.price_level || null,
                    types: place.types || [],
                    vicinity: place.vicinity || null,
                    website: place.website || null,
                    phone: place.formatted_phone_number || null
                }
            });
            
            // Add location metadata if available
            if (place.geometry && place.geometry.location) {
                entity.metadata.push({
                    type: 'location',
                    source: 'google_places_api',
                    data: {
                        latitude: typeof place.geometry.location.lat === 'function'
                            ? place.geometry.location.lat()
                            : place.geometry.location.lat,
                        longitude: typeof place.geometry.location.lng === 'function'
                            ? place.geometry.location.lng()
                            : place.geometry.location.lng,
                        address: place.formatted_address || place.vicinity || null
                    }
                });
            }
            
            return entity;
        }
        
        /**
         * Extract description from place data
         * @param {Object} place - Google Place object
         * @returns {string} - Generated description
         */
        extractDescription(place) {
            const parts = [];
            
            // Add cuisine/category
            const cuisine = this.extractCuisine(place);
            if (cuisine) {
                parts.push(cuisine);
            }
            
            // Add location info
            if (place.vicinity) {
                parts.push(`Located in ${place.vicinity}`);
            }
            
            // Add rating info
            if (place.rating) {
                parts.push(`Rated ${place.rating}/5 by ${place.user_ratings_total || 0} users`);
            }
            
            return parts.join('. ') || 'Restaurant imported from Google Places';
        }
        
        /**
         * Extract subtype from place types
         * @param {Object} place - Google Place object
         * @returns {string} - Subtype (restaurant, cafe, etc.)
         */
        extractSubtype(place) {
            if (!place.types || place.types.length === 0) {
                return 'restaurant';
            }
            
            // Priority order for subtypes
            const subtypePriority = [
                'restaurant',
                'cafe',
                'bar',
                'bakery',
                'meal_takeaway',
                'meal_delivery'
            ];
            
            for (const type of subtypePriority) {
                if (place.types.includes(type)) {
                    return type;
                }
            }
            
            return 'restaurant';
        }
        
        /**
         * Extract cuisine type from place data
         * @param {Object} place - Google Place object
         * @returns {string|null} - Cuisine type or null
         */
        extractCuisine(place) {
            if (!place.types || place.types.length === 0) {
                return null;
            }
            
            for (const type of place.types) {
                if (this.cuisineMapping[type]) {
                    return this.cuisineMapping[type];
                }
            }
            
            return null;
        }
        
        /**
         * Extract concepts from place data and reviews
         * @param {Object} place - Google Place object with reviews
         * @returns {Array<string>} - Array of concept strings
         */
        extractConcepts(place) {
            const concepts = new Set();
            
            // Extract from types
            if (place.types) {
                for (const type of place.types) {
                    if (!this.excludedTypes.includes(type)) {
                        const readable = this.typeToReadable(type);
                        if (readable) {
                            concepts.add(readable);
                        }
                    }
                }
            }
            
            // Extract cuisine
            const cuisine = this.extractCuisine(place);
            if (cuisine) {
                concepts.add(cuisine);
            }
            
            // Extract from reviews (simple keyword extraction)
            if (place.reviews && place.reviews.length > 0) {
                const keywords = this.extractKeywordsFromReviews(place.reviews);
                keywords.forEach(keyword => concepts.add(keyword));
            }
            
            return Array.from(concepts);
        }
        
        /**
         * Convert Google Place type to readable format
         * @param {string} type - Google Place type
         * @returns {string} - Readable type
         */
        typeToReadable(type) {
            return type
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        
        /**
         * Extract keywords from reviews using simple heuristics
         * @param {Array<Object>} reviews - Array of review objects
         * @returns {Array<string>} - Extracted keywords
         */
        extractKeywordsFromReviews(reviews) {
            const keywords = new Set();
            
            // Common food/restaurant keywords to look for
            const foodKeywords = [
                'pasta', 'pizza', 'burger', 'steak', 'seafood', 'sushi',
                'salad', 'soup', 'dessert', 'wine', 'beer', 'cocktail',
                'breakfast', 'brunch', 'lunch', 'dinner', 'cozy', 'romantic',
                'family-friendly', 'authentic', 'traditional', 'modern',
                'fusion', 'organic', 'vegan', 'vegetarian', 'gluten-free'
            ];
            
            // Take top 3 reviews
            const topReviews = reviews.slice(0, 3);
            
            for (const review of topReviews) {
                if (!review.text) continue;
                
                const text = review.text.toLowerCase();
                
                for (const keyword of foodKeywords) {
                    if (text.includes(keyword)) {
                        keywords.add(keyword.charAt(0).toUpperCase() + keyword.slice(1));
                    }
                }
            }
            
            return Array.from(keywords);
        }
        
        /**
         * Format place photos for display
         * @param {Array<Object>} photos - Google Photos array
         * @param {number} maxWidth - Maximum photo width
         * @returns {Array<string>} - Array of photo URLs
         */
        formatPhotos(photos, maxWidth = 800) {
            if (!photos || photos.length === 0) {
                return [];
            }
            
            return photos.slice(0, 5).map(photo => {
                if (typeof photo.getUrl === 'function') {
                    return photo.getUrl({ maxWidth });
                }
                return null;
            }).filter(url => url !== null);
        }
        
        /**
         * Format display info for search results
         * @param {Object} place - Google Place object
         * @returns {Object} - Formatted display data
         */
        formatDisplayInfo(place) {
            return {
                name: place.name || 'Unknown',
                address: place.formatted_address || place.vicinity || 'No address',
                rating: place.rating ? `${place.rating}/5` : 'No rating',
                ratingCount: place.user_ratings_total || 0,
                types: this.formatTypes(place.types),
                priceLevel: this.formatPriceLevel(place.price_level),
                isOpen: this.formatOpenStatus(place.opening_hours)
            };
        }
        
        /**
         * Format types for display (exclude common types)
         * @param {Array<string>} types - Place types
         * @returns {Array<string>} - Formatted types
         */
        formatTypes(types) {
            if (!types || types.length === 0) {
                return [];
            }
            
            return types
                .filter(type => !this.excludedTypes.includes(type))
                .map(type => this.typeToReadable(type))
                .slice(0, 3);
        }
        
        /**
         * Format price level to display string
         * @param {number} priceLevel - Price level (0-4)
         * @returns {string} - Formatted price level
         */
        formatPriceLevel(priceLevel) {
            if (priceLevel === undefined || priceLevel === null) {
                return 'Price not available';
            }
            
            const symbols = ['Free', '$', '$$', '$$$', '$$$$'];
            return symbols[priceLevel] || 'Unknown';
        }
        
        /**
         * Format opening hours status
         * @param {Object} openingHours - Opening hours object
         * @returns {string} - Open status
         */
        formatOpenStatus(openingHours) {
            if (!openingHours) {
                return 'Hours unknown';
            }
            
            if (openingHours.open_now !== undefined) {
                return openingHours.open_now ? 'Open now' : 'Closed';
            }
            
            return 'Hours unknown';
        }
    }
    
    // Create and return singleton instance
    return new PlacesFormatterClass();
})();

// Attach to window for global access
if (typeof window !== 'undefined') {
    window.PlacesFormatter = PlacesFormatter;
}
