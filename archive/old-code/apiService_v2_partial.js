/**
 * File: apiService.js
 * Purpose: API Service - Entity-Curation API Client
 * Dependencies: AppConfig, Logger
 * 
 * Main Responsibilities:
 * - Handle all API communications
 * - Implement optimistic locking with ETags
 * - Support flexible querying and real-time updates
 * - Manage authentication and error handling
 * - Provide clean abstraction for API operations
 */

const ApiService = ModuleWrapper.defineClass('ApiService', class {
    constructor() {
        this.log = Logger.module('ApiService');
        this.baseUrl = AppConfig.api.backend.baseUrl;
        this.timeout = AppConfig.api.backend.timeout;
        this.retryAttempts = AppConfig.api.backend.retryAttempts;
        this.retryDelay = AppConfig.api.backend.retryDelay;
        this.isInitialized = false;
        
        // Request interceptors
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        
        this.setupDefaultInterceptors();
    }

    /**
     * Initialize V3 API Service
     */
    async initialize() {
        try {
            this.log.debug('🚀 Initializing V3 API Service...');
            
            // Validate configuration
            if (!this.baseUrl) {
                throw new Error('API base URL not configured');
            }
            
            // Check for existing auth token
            const token = this.getAuthToken();
            if (token) {
                this.log.debug('✅ Found existing auth token');
            } else {
                this.log.warn('⚠️ No auth token found - authentication optional for V3 API');
            }
            
            this.isInitialized = true;
            this.log.debug('✅ V3 API Service initialized successfully');
            return this;
            
        } catch (error) {
            this.log.error('❌ Failed to initialize V3 API Service:', error);
            throw error;
        }
    }

    // ========================================
