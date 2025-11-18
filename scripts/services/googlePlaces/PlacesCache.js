/**
 * PlacesCache - Intelligent Caching for Google Places API
 * 
 * Purpose: Reduce API calls and improve performance through intelligent caching
 * 
 * Main Responsibilities:
 * - In-memory caching with TTL (Time To Live)
 * - Cache key generation from search parameters
 * - Cache hit/miss tracking
 * - Automatic cache cleanup
 * - Memory-efficient storage
 * 
 * Dependencies: None (standalone service)
 */

const PlacesCache = (function() {
    'use strict';
    
    /**
     * Intelligent caching layer for Places API responses
     */
    class PlacesCacheClass {
        constructor() {
            this.log = Logger.module('PlacesCache');
            
            // Cache storage
            this.cache = new Map();
            
            // Configuration
            this.defaultTTL = 15 * 60 * 1000; // 15 minutes
            this.maxCacheSize = 100; // Maximum cached entries
            
            // Statistics
            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                totalSaved: 0
            };
            
            // Cleanup interval
            this.cleanupInterval = null;
            this.startCleanupTimer();
        }
        
        /**
         * Get cached data by key
         * @param {string} key - Cache key
         * @returns {any|null} - Cached data or null if not found/expired
         */
        get(key) {
            const entry = this.cache.get(key);
            
            if (!entry) {
                this.stats.misses++;
                this.log.debug('Cache miss:', key);
                return null;
            }
            
            // Check if expired
            if (Date.now() > entry.expiresAt) {
                this.cache.delete(key);
                this.stats.misses++;
                this.log.debug('Cache expired:', key);
                return null;
            }
            
            // Update access time
            entry.lastAccessed = Date.now();
            
            this.stats.hits++;
            this.log.debug('Cache hit:', key);
            return entry.data;
        }
        
        /**
         * Store data in cache
         * @param {string} key - Cache key
         * @param {any} data - Data to cache
         * @param {number} ttl - Time to live in milliseconds (optional)
         */
        set(key, data, ttl = this.defaultTTL) {
            // Enforce cache size limit
            if (this.cache.size >= this.maxCacheSize) {
                this.evictOldest();
            }
            
            const entry = {
                data: data,
                createdAt: Date.now(),
                lastAccessed: Date.now(),
                expiresAt: Date.now() + ttl
            };
            
            this.cache.set(key, entry);
            this.log.debug('Cached:', key);
        }
        
        /**
         * Check if key exists in cache and is not expired
         * @param {string} key - Cache key
         * @returns {boolean} - True if exists and valid
         */
        has(key) {
            const entry = this.cache.get(key);
            
            if (!entry) {
                return false;
            }
            
            if (Date.now() > entry.expiresAt) {
                this.cache.delete(key);
                return false;
            }
            
            return true;
        }
        
        /**
         * Remove entry from cache
         * @param {string} key - Cache key
         */
        delete(key) {
            this.cache.delete(key);
            this.log.debug('Deleted from cache:', key);
        }
        
        /**
         * Clear all cached entries
         */
        clear() {
            const size = this.cache.size;
            this.cache.clear();
            this.log.info(`Cache cleared: ${size} entries removed`);
        }
        
        /**
         * Generate cache key for nearby search
         * @param {Object} params - Search parameters
         * @returns {string} - Cache key
         */
        nearbySearchKey({ latitude, longitude, radius, type, keyword }) {
            const lat = latitude.toFixed(4);
            const lng = longitude.toFixed(4);
            const parts = ['nearby', lat, lng, radius, type];
            
            if (keyword) {
                parts.push(keyword);
            }
            
            return parts.join(':');
        }
        
        /**
         * Generate cache key for text search
         * @param {Object} params - Search parameters
         * @returns {string} - Cache key
         */
        textSearchKey({ query, latitude, longitude, radius }) {
            const parts = ['text', query.toLowerCase()];
            
            if (latitude && longitude) {
                parts.push(latitude.toFixed(4), longitude.toFixed(4));
                if (radius) {
                    parts.push(radius);
                }
            }
            
            return parts.join(':');
        }
        
        /**
         * Generate cache key for place details
         * @param {string} placeId - Google Place ID
         * @returns {string} - Cache key
         */
        placeDetailsKey(placeId) {
            return `details:${placeId}`;
        }
        
        /**
         * Generate cache key for geocoding
         * @param {string} address - Address to geocode
         * @returns {string} - Cache key
         */
        geocodeKey(address) {
            return `geocode:${address.toLowerCase().trim()}`;
        }
        
        /**
         * Evict oldest entry from cache
         */
        evictOldest() {
            let oldestKey = null;
            let oldestTime = Infinity;
            
            for (const [key, entry] of this.cache.entries()) {
                if (entry.lastAccessed < oldestTime) {
                    oldestTime = entry.lastAccessed;
                    oldestKey = key;
                }
            }
            
            if (oldestKey) {
                this.cache.delete(oldestKey);
                this.stats.evictions++;
                this.log.debug('Evicted oldest entry:', oldestKey);
            }
        }
        
        /**
         * Start automatic cleanup timer
         */
        startCleanupTimer() {
            // Run cleanup every 5 minutes
            this.cleanupInterval = setInterval(() => {
                this.cleanup();
            }, 5 * 60 * 1000);
            
            this.log.info('Cleanup timer started');
        }
        
        /**
         * Stop automatic cleanup timer
         */
        stopCleanupTimer() {
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
                this.log.info('Cleanup timer stopped');
            }
        }
        
        /**
         * Remove expired entries from cache
         */
        cleanup() {
            const now = Date.now();
            let removed = 0;
            
            for (const [key, entry] of this.cache.entries()) {
                if (now > entry.expiresAt) {
                    this.cache.delete(key);
                    removed++;
                }
            }
            
            if (removed > 0) {
                this.log.info(`Cleanup removed ${removed} expired entries`);
            }
        }
        
        /**
         * Get cache statistics
         * @returns {Object} - Statistics object
         */
        getStats() {
            const hitRate = this.stats.hits + this.stats.misses > 0
                ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
                : 0;
            
            return {
                size: this.cache.size,
                maxSize: this.maxCacheSize,
                hits: this.stats.hits,
                misses: this.stats.misses,
                hitRate: `${hitRate}%`,
                evictions: this.stats.evictions,
                totalSaved: this.stats.totalSaved
            };
        }
        
        /**
         * Reset statistics
         */
        resetStats() {
            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                totalSaved: 0
            };
            this.log.info('Stats reset');
        }
        
        /**
         * Get cache size in approximate bytes (for monitoring)
         * @returns {number} - Approximate memory usage
         */
        getMemoryUsage() {
            let total = 0;
            
            for (const entry of this.cache.values()) {
                // Rough estimate: JSON string length
                total += JSON.stringify(entry.data).length;
            }
            
            return total;
        }
    }
    
    // Create and return singleton instance
    return new PlacesCacheClass();
})();

// Attach to window for global access
if (typeof window !== 'undefined') {
    window.PlacesCache = PlacesCache;
}
