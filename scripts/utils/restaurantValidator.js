/**
 * Restaurant Validator Utility
 * 
 * Purpose: Validate restaurants before upload and extract city information
 * Main Responsibilities:
 * - Validate restaurant data completeness
 * - Extract city from multiple sources (Michelin, Google Places, address)
 * - Ensure data meets server requirements for duplicate prevention
 * 
 * Dependencies: None (pure utility functions)
 */

const RestaurantValidator = ModuleWrapper.defineClass('RestaurantValidator', class {
    constructor() {
        // Country names to skip when parsing cities from addresses
        this.countryNames = [
            'USA', 'UNITED STATES', 'ITALY', 'ITALIA', 'FRANCE', 'SPAIN', 
            'ESPAÑA', 'UK', 'UNITED KINGDOM', 'GERMANY', 'DEUTSCHLAND', 
            'JAPAN', '日本', 'CHINA', '中国', 'BRAZIL', 'BRASIL'
        ];
    }

    /**
     * Validate restaurant before upload
     * @param {Object} restaurant - Restaurant object to validate
     * @returns {Object} - { valid: boolean, issues: string[], city: string|null }
     */
    validateForUpload(restaurant) {
        const issues = [];
        
        // Check required fields
        if (!restaurant.name || restaurant.name.trim() === '') {
            issues.push('Restaurant name is required');
        }
        
        if (!restaurant.curatorId) {
            issues.push('Curator ID is required');
        }
        
        // Extract city for duplicate prevention
        const city = this.extractCity(restaurant);
        if (!city) {
            issues.push('Unable to determine city - may cause duplicate issues');
        }
        
        // Warnings for missing optional data
        if (!restaurant.location) {
            issues.push('Warning: No location data - consider adding GPS coordinates');
        }
        
        if (!restaurant.description && !restaurant.transcription) {
            issues.push('Warning: No description or transcription provided');
        }
        
        return {
            valid: issues.filter(i => !i.startsWith('Warning:')).length === 0,
            issues: issues,
            city: city
        };
    }

    /**
     * Extract city from restaurant data
     * Priority: Michelin > Google Places > Address parsing
     * @param {Object} restaurant - Restaurant object
     * @returns {string|null} - Extracted city name or null
     */
    extractCity(restaurant) {
        // Priority 1: Michelin Guide city (most reliable)
        if (restaurant.michelinData && restaurant.michelinData.guide && restaurant.michelinData.guide.city) {
            return restaurant.michelinData.guide.city;
        }
        
        // Priority 2: Google Places vicinity
        if (restaurant.googlePlacesData && restaurant.googlePlacesData.location && restaurant.googlePlacesData.location.vicinity) {
            const city = this.parseCityFromAddress(restaurant.googlePlacesData.location.vicinity);
            if (city) return city;
        }
        
        // Priority 3: Collector address parsing
        if (restaurant.location && restaurant.location.address) {
            const city = this.parseCityFromAddress(restaurant.location.address);
            if (city) return city;
        }
        
        return null;
    }

    /**
     * Parse city name from address string
     * Filters out postal codes, country names, and street addresses
     * @param {string} address - Full address string
     * @returns {string|null} - Extracted city name or null
     */
    parseCityFromAddress(address) {
        if (!address || typeof address !== 'string') {
            return null;
        }
        
        // Split by common delimiters
        const parts = address.split(/[,;]/);
        
        for (const part of parts) {
            const trimmed = part.trim();
            
            // Skip empty parts
            if (!trimmed) continue;
            
            // Skip postal codes (numbers or patterns like "12345" or "AB12 3CD")
            if (/^\d+$/.test(trimmed) || /^[A-Z0-9]{2,}\s*\d/.test(trimmed)) {
                continue;
            }
            
            // Skip if starts with a number (likely street address)
            if (/^\d/.test(trimmed)) {
                continue;
            }
            
            // Skip country names
            if (this.isCountryName(trimmed)) {
                continue;
            }
            
            // This is likely the city
            return trimmed;
        }
        
        return null;
    }

    /**
     * Check if string is a country name
     * @param {string} str - String to check
     * @returns {boolean}
     */
    isCountryName(str) {
        const upperStr = str.toUpperCase().trim();
        return this.countryNames.some(country => upperStr === country);
    }

    /**
     * Validate city extraction works correctly (for testing)
     * @param {Array} testCases - Array of test case objects
     * @returns {Object} - Test results
     */
    testCityExtraction(testCases) {
        const results = {
            passed: 0,
            failed: 0,
            details: []
        };
        
        for (const testCase of testCases) {
            const extracted = this.extractCity(testCase.restaurant);
            const passed = extracted === testCase.expectedCity;
            
            if (passed) {
                results.passed++;
            } else {
                results.failed++;
            }
            
            results.details.push({
                name: testCase.name,
                expected: testCase.expectedCity,
                actual: extracted,
                passed: passed
            });
        }
        
        return results;
    }
});

// Create global instance
window.restaurantValidator = ModuleWrapper.createInstance('restaurantValidator', 'RestaurantValidator');
