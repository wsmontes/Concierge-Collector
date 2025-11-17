/**
 * File: apiServiceV4Extensions.js
 * Purpose: V4-specific API methods with automatic data transformation
 * Dependencies: ApiService, SyncAdapterV4
 * 
 * Extends ApiService with V4-compatible methods that handle:
 * - Pagination format (items/total/skip/limit)
 * - Data transformation (V3/local ↔ V4)
 * - Version-based optimistic locking
 * 
 * This file adds methods to the ApiService prototype after it's loaded.
 */

(function() {
    'use strict';
    
    // Function to extend ApiService with V4 methods
    function extendApiServiceWithV4() {
        if (!window.ApiService) {
            console.error('❌ ApiService not found - cannot load V4 extensions');
            return false;
        }
        
        const ApiServicePrototype = window.ApiService.constructor.prototype;
        
        /**
         * Get entities from V4 API with automatic response adaptation
         */
        ApiServicePrototype.getEntitiesV4 = async function(params = {}) {
            try {
                const queryParams = window.SyncAdapterV4.buildV4QueryParams(params);
                const url = `/entities${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
                
                this.log.debug('📥 V4 GET entities:', url);
                const response = await this.get(url);
                
                const adapted = window.SyncAdapterV4.adaptPaginatedResponse(response);
                const entities = adapted.items.map(e => window.SyncAdapterV4.entityFromV4(e));
                
                this.log.debug(`✅ V4 entities received: ${entities.length}`);
                return { entities, pagination: adapted.pagination };
                
            } catch (error) {
                this.log.error('❌ getEntitiesV4 failed:', error);
                return { 
                    entities: [], 
                    pagination: { total: 0, skip: 0, limit: params.limit || 20, hasMore: false } 
                };
            }
        };

        /**
         * Create entity in V4 API with automatic data transformation
         */
        ApiServicePrototype.createEntityV4 = async function(entityData) {
            try {
                this.log.debug('📤 V4 POST entity:', entityData.name);
                
                const v4Entity = window.SyncAdapterV4.entityToV4(entityData);
                const validated = window.SyncAdapterV4.validateEntityForV4(v4Entity);
                
                const response = await this.post('/entities', validated);
                const localEntity = window.SyncAdapterV4.entityFromV4(response);
                
                this.log.debug('✅ V4 entity created:', localEntity.entity_id);
                return localEntity;
                
            } catch (error) {
                this.log.error('❌ createEntityV4 failed:', error);
                throw error;
            }
        };

        /**
         * Update entity in V4 API (PUT with version field)
         */
        ApiServicePrototype.updateEntityV4 = async function(entityId, updateData, version) {
            try {
                this.log.debug('📤 V4 PUT entity:', entityId, 'version:', version);
                
                const v4Entity = window.SyncAdapterV4.entityToV4({
                    ...updateData,
                    entity_id: entityId,
                    version: version
                });
                
                const response = await this.put(`/entities/${entityId}`, v4Entity);
                const localEntity = window.SyncAdapterV4.entityFromV4(response);
                
                this.log.debug('✅ V4 entity updated:', localEntity.entity_id);
                return localEntity;
                
            } catch (error) {
                this.log.error('❌ updateEntityV4 failed:', error);
                throw error;
            }
        };

        /**
         * Get curations from V4 API with automatic response adaptation
         */
        ApiServicePrototype.getCurationsV4 = async function(params = {}) {
            try {
                const queryParams = window.SyncAdapterV4.buildV4QueryParams(params);
                const url = `/curations${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
                
                this.log.debug('📥 V4 GET curations:', url);
                const response = await this.get(url);
                
                const adapted = window.SyncAdapterV4.adaptPaginatedResponse(response);
                const curations = adapted.items.map(c => window.SyncAdapterV4.curationFromV4(c));
                
                this.log.debug(`✅ V4 curations received: ${curations.length}`);
                return { curations, pagination: adapted.pagination };
                
            } catch (error) {
                this.log.error('❌ getCurationsV4 failed:', error);
                return { 
                    curations: [], 
                    pagination: { total: 0, skip: 0, limit: params.limit || 20, hasMore: false } 
                };
            }
        };

        /**
         * Create curation in V4 API with automatic data transformation
         */
        ApiServicePrototype.createCurationV4 = async function(curationData) {
            try {
                this.log.debug('📤 V4 POST curation for entity:', curationData.entity_id);
                
                const v4Curation = window.SyncAdapterV4.curationToV4(curationData);
                const response = await this.post('/curations', v4Curation);
                const localCuration = window.SyncAdapterV4.curationFromV4(response);
                
                this.log.debug('✅ V4 curation created:', localCuration.curation_id);
                return localCuration;
                
            } catch (error) {
                this.log.error('❌ createCurationV4 failed:', error);
                throw error;
            }
        };

        /**
         * Update curation in V4 API (PUT with version field)
         */
        ApiServicePrototype.updateCurationV4 = async function(curationId, updateData, version) {
            try {
                this.log.debug('📤 V4 PUT curation:', curationId, 'version:', version);
                
                const v4Curation = window.SyncAdapterV4.curationToV4({
                    ...updateData,
                    curation_id: curationId,
                    version: version
                });
                
                const response = await this.put(`/curations/${curationId}`, v4Curation);
                const localCuration = window.SyncAdapterV4.curationFromV4(response);
                
                this.log.debug('✅ V4 curation updated:', localCuration.curation_id);
                return localCuration;
                
            } catch (error) {
                this.log.error('❌ updateCurationV4 failed:', error);
                throw error;
            }
        };

        console.log('✅ ApiService V4 extensions loaded');
        return true;
    }
    
    // Try to extend immediately if ApiService is already loaded
    if (window.ApiService) {
        extendApiServiceWithV4();
    } else {
        // Otherwise wait for it
        console.log('⏳ Waiting for ApiService to load...');
        const checkInterval = setInterval(() => {
            if (window.ApiService) {
                clearInterval(checkInterval);
                extendApiServiceWithV4();
            }
        }, 50);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.ApiService) {
                console.error('❌ Timeout waiting for ApiService');
            }
        }, 5000);
    }
    
    // Expose extension function globally for manual invocation if needed
    window.extendApiServiceWithV4 = extendApiServiceWithV4;
})();
