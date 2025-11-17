/**
 * File: syncAdapterV4.js
 * Purpose: V3→V4 Data Adapter for Sync Operations
 * Dependencies: None (pure transformation functions)
 * 
 * Main Responsibilities:
 * - Transform V3 entity/curation format ↔ V4 format
 * - Handle ID mapping (id ↔ entity_id/curation_id)
 * - Convert ETag ↔ version field
 * - Adapt pagination format
 * - Handle soft delete flags
 */

window.SyncAdapterV4 = {
    /**
     * Transform V3 entity to V4 entity format
     * @param {Object} v3Entity - Entity in V3 format
     * @returns {Object} - Entity in V4 format
     */
    entityToV4(v3Entity) {
        const v4Entity = {
            entity_id: v3Entity.entity_id || v3Entity.id,
            type: v3Entity.type || 'restaurant',
            name: v3Entity.name,
            status: v3Entity.status || 'active',
            
            // Location (adapt if needed)
            location: this.adaptLocationToV4(v3Entity.location, v3Entity),
            
            // Contact (adapt if needed) - use null for empty strings (API validation)
            contact: this.adaptContactToV4(v3Entity.contact, v3Entity),
            
            // Metadata - V4 expects array, V3 might be object or array
            metadata: this.adaptMetadataToV4(v3Entity.metadata || v3Entity.data),
            
            // Tags
            tags: v3Entity.tags || [],
            
            // Timestamps and creator - V4 uses snake_case
            created_by: v3Entity.created_by || v3Entity.createdBy || 'unknown',
            created_at: v3Entity.created_at || v3Entity.createdAt || new Date().toISOString(),
            updated_at: v3Entity.updated_at || v3Entity.updatedAt || new Date().toISOString(),
            
            // Version - V4 uses integer, V3 uses ETag
            version: v3Entity.version || 1
        };
        
        return v4Entity;
    },

    /**
     * Transform V4 entity to V3/local format
     * @param {Object} v4Entity - Entity in V4 format
     * @returns {Object} - Entity in local format
     */
    entityFromV4(v4Entity) {
        return {
            // Don't include 'id' - let Dexie auto-increment it
            entity_id: v4Entity.entity_id,
            type: v4Entity.type,
            name: v4Entity.name,
            status: v4Entity.status,
            
            // Flatten location/contact for easier local access
            location: v4Entity.location ? {
                ...v4Entity.location,
                latitude: v4Entity.location.coordinates?.latitude,
                longitude: v4Entity.location.coordinates?.longitude
            } : null,
            address: v4Entity.location?.address,
            city: v4Entity.location?.city,
            country: v4Entity.location?.country,
            coordinates: v4Entity.location?.coordinates,
            
            contact: v4Entity.contact,
            phone: v4Entity.contact?.phone,
            email: v4Entity.contact?.email,
            website: v4Entity.contact?.website,
            
            // Metadata
            metadata: v4Entity.metadata,
            data: this.metadataArrayToObject(v4Entity.metadata),
            
            // Tags
            tags: v4Entity.tags || [],
            
            // Timestamps - V4 uses snake_case, convert to camelCase for local
            created_by: v4Entity.created_by,
            createdBy: v4Entity.created_by,
            created_at: v4Entity.created_at ? new Date(v4Entity.created_at) : null,
            createdAt: v4Entity.created_at ? new Date(v4Entity.created_at) : null,
            updated_at: v4Entity.updated_at ? new Date(v4Entity.updated_at) : null,
            updatedAt: v4Entity.updated_at ? new Date(v4Entity.updated_at) : null,
            
            // Version
            version: v4Entity.version,
            etag: `v${v4Entity.version}`  // Synthetic ETag for compatibility
        };
    },

    /**
     * Transform V3 curation to V4 curation format
     * @param {Object} v3Curation - Curation in V3 format
     * @returns {Object} - Curation in V4 format
     */
    curationToV4(v3Curation) {
        return {
            curation_id: v3Curation.curation_id || v3Curation.id,
            entity_id: v3Curation.entity_id,
            curator_id: v3Curation.curator_id || v3Curation.curatorId || 'unknown',
            
            category: v3Curation.category || 'general',
            concept: v3Curation.concept || '',
            notes: v3Curation.notes || '',
            
            // Tags
            tags: v3Curation.tags || [],
            
            // Metadata - V4 expects array
            metadata: this.adaptMetadataToV4(v3Curation.metadata || v3Curation.data),
            
            // Timestamps
            createdAt: v3Curation.createdAt || v3Curation.created_at || new Date().toISOString(),
            updatedAt: v3Curation.updatedAt || v3Curation.updated_at || new Date().toISOString(),
            
            // Version
            version: v3Curation.version || 1,
            
            // V4 soft delete field
            is_deleted: v3Curation.is_deleted || false
        };
    },

    /**
     * Transform V4 curation to V3/local format
     * @param {Object} v4Curation - Curation in V4 format
     * @returns {Object} - Curation in local format
     */
    curationFromV4(v4Curation) {
        return {
            id: v4Curation.id,  // Auto-increment for Dexie
            curation_id: v4Curation.curation_id,
            entity_id: v4Curation.entity_id,
            curator_id: v4Curation.curator_id,
            
            category: v4Curation.category,
            concept: v4Curation.concept,
            notes: v4Curation.notes,
            
            // Tags
            tags: v4Curation.tags || [],
            
            // Metadata
            metadata: v4Curation.metadata,
            data: this.metadataArrayToObject(v4Curation.metadata),
            
            // Timestamps
            createdAt: new Date(v4Curation.createdAt),
            updatedAt: new Date(v4Curation.updatedAt),
            
            // Version
            version: v4Curation.version,
            etag: `v${v4Curation.version}`,  // Synthetic ETag
            
            // Soft delete
            is_deleted: v4Curation.is_deleted || false
        };
    },

    /**
     * Adapt location for V4 format
     * @param {Object} location - V3 location object
     * @param {Object} entity - Full entity (fallback for lat/lng in root)
     * @returns {Object|null} - V4 location format or null
     */
    adaptLocationToV4(location, entity) {
        if (!location) return null;
        
        // Check if location has lat/lng directly
        const lat = location.latitude || location.lat;
        const lng = location.longitude || location.lng || location.lon;
        
        return {
            address: location.address || '',
            city: location.city || '',
            state: location.state || '',
            country: location.country || '',
            postal_code: location.postal_code || location.postalCode || '',
            coordinates: (lat && lng) ? {
                latitude: lat,
                longitude: lng
            } : null
        };
    },

    /**
     * Adapt contact for V4 format
     * @param {Object} contact - V3 contact object
     * @param {Object} entity - Full entity (fallback)
     * @returns {Object} - V4 contact format with null for empty values
     */
    adaptContactToV4(contact, entity) {
        const phone = contact?.phone || entity?.phone || '';
        const email = contact?.email || entity?.email || '';
        const website = contact?.website || entity?.website || '';
        
        return {
            phone: phone || null,
            email: email || null,  // null instead of empty string for validation
            website: website || null
        };
    },

    /**
     * Adapt metadata to V4 array format
     * @param {Object|Array} metadata - Metadata in any format
     * @returns {Array} - Metadata array for V4
     */
    adaptMetadataToV4(metadata) {
        if (!metadata) return [];
        
        // If already array, return as-is
        if (Array.isArray(metadata)) {
            return metadata.map(m => ({
                type: m.type || 'custom',
                source: m.source || 'unknown',
                data: m.data || m,
                timestamp: m.timestamp || new Date().toISOString()
            }));
        }
        
        // If object, convert to array with single item
        return [{
            type: 'legacy',
            source: 'v3_migration',
            data: metadata,
            timestamp: new Date().toISOString()
        }];
    },

    /**
     * Convert metadata array to object for local storage compatibility
     * @param {Array} metadataArray - V4 metadata array
     * @returns {Object} - Flattened metadata object
     */
    metadataArrayToObject(metadataArray) {
        if (!metadataArray || !Array.isArray(metadataArray)) return {};
        
        const result = {};
        metadataArray.forEach((item, index) => {
            const key = item.type || `item_${index}`;
            result[key] = item.data;
        });
        
        return result;
    },

    /**
     * Adapt V4 paginated response to simple array
     * @param {Object} v4Response - V4 response with items/total/skip/limit
     * @returns {Object} - {items, pagination}
     */
    adaptPaginatedResponse(v4Response) {
        // API can wrap response in {success, data: {...}} OR return directly
        // API returns {entities: [...], total, skip, limit} OR {items: [...], total, skip, limit}
        const data = v4Response.data || v4Response;
        const items = data.items || data.entities || data.curations || [];
        const total = data.total || 0;
        const skip = data.skip || 0;
        const limit = data.limit || 100;
        
        return {
            items: items,
            pagination: {
                total: total,
                skip: skip,
                limit: limit,
                hasMore: (skip + items.length) < total
            }
        };
    },

    /**
     * Build V4 query params from filters
     * @param {Object} filters - Filter object
     * @returns {URLSearchParams} - Query params
     */
    buildV4QueryParams(filters = {}) {
        const params = new URLSearchParams();
        
        // Pagination
        if (filters.skip !== undefined) params.append('skip', filters.skip);
        if (filters.limit !== undefined) params.append('limit', filters.limit);
        
        // Entity filters
        if (filters.type) params.append('type', filters.type);
        if (filters.status) params.append('status', filters.status);
        if (filters.city) params.append('city', filters.city);
        if (filters.country) params.append('country', filters.country);
        if (filters.curator_id) params.append('curator_id', filters.curator_id);
        
        // Curation filters
        if (filters.entity_id) params.append('entity_id', filters.entity_id);
        if (filters.category) params.append('category', filters.category);
        
        // Tags (can be multiple)
        if (filters.tags && Array.isArray(filters.tags)) {
            filters.tags.forEach(tag => params.append('tags', tag));
        }
        
        return params;
    },

    /**
     * Validate entity against V4 enums
     * @param {Object} entity - Entity to validate
     * @returns {Object} - Validated entity with defaults
     */
    validateEntityForV4(entity) {
        const validTypes = ['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other'];
        const validStatuses = ['active', 'archived', 'deleted', 'draft'];
        
        return {
            ...entity,
            type: validTypes.includes(entity.type) ? entity.type : 'restaurant',
            status: validStatuses.includes(entity.status) ? entity.status : 'active'
        };
    }
};
