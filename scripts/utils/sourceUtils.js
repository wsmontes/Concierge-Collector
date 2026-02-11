/**
 * SourceUtils - Standardized logic for Curation Sources
 * 
 * Centralizes the definition, detection, and UI mapping of data sources.
 * Prevents ad-hoc string usage and ensures consistent UI representation.
 */

const SourceUtils = (() => {
    // 1. Define Standard Source Constants (Backend Contract)
    const SCOPES = {
        AUDIO: 'audio',
        IMAGE: 'image',
        TEXT: 'text',
        GOOGLE: 'google_places',
        IMPORT: 'import',
        MANUAL: 'manual'
    };

    // 2. Define UI Mappings (Frontend Representation)
    const UI_CONFIG = {
        [SCOPES.AUDIO]: {
            label: 'Voice Note',
            icon: 'mic',
            className: 'badge-purple' // Maps to CSS class
        },
        [SCOPES.IMAGE]: {
            label: 'Photo',
            icon: 'photo_camera',
            className: 'badge-pink'
        },
        [SCOPES.TEXT]: {
            label: 'Text Input',
            icon: 'text_fields',
            className: 'badge-blue'
        },
        [SCOPES.GOOGLE]: {
            label: 'Google Places',
            icon: 'place',
            className: 'badge-green'
        },
        [SCOPES.IMPORT]: {
            label: 'Imported',
            icon: 'file_upload',
            className: 'badge-amber'
        },
        [SCOPES.MANUAL]: {
            label: 'Manual Entry',
            icon: 'edit',
            className: 'badge-gray'
        }
    };

    /**
     * Detects the primary source of a curation based on its data fields.
     * Priority: Audio > Image > Text > Google > Import > Manual
     * 
     * @param {Object} curation - The curation object
     * @param {Object} entity - The associated entity object (optional)
     * @returns {Object} UI configuration object { label, icon, className }
     */
    function detectSource(curation, entity) {
        const sources = curation.sources || [];

        // Check for explicit sources first (preserves backend truth)
        if (sources.length > 0) {
            // Return priority source if multiple exist
            if (sources.includes(SCOPES.AUDIO)) return UI_CONFIG[SCOPES.AUDIO];
            if (sources.includes(SCOPES.IMAGE)) return UI_CONFIG[SCOPES.IMAGE];
            if (sources.includes(SCOPES.TEXT)) return UI_CONFIG[SCOPES.TEXT];
            if (sources.includes(SCOPES.GOOGLE)) return UI_CONFIG[SCOPES.GOOGLE];
            if (sources.includes(SCOPES.IMPORT)) return UI_CONFIG[SCOPES.IMPORT];
            if (sources.includes(SCOPES.MANUAL)) return UI_CONFIG[SCOPES.MANUAL];

            // Fallback for unknown explicit source
            return UI_CONFIG[SCOPES.MANUAL];
        }

        // Heuristic fallback for legacy data (smart detection)
        if (curation.transcription && curation.transcription.trim().length > 0) {
            return UI_CONFIG[SCOPES.AUDIO];
        }

        if (curation.photos && curation.photos.length > 0) {
            return UI_CONFIG[SCOPES.IMAGE];
        }

        if (entity?.data?.place_id || entity?.place_id || curation.googlePlaceId) {
            return UI_CONFIG[SCOPES.GOOGLE];
        }

        return UI_CONFIG[SCOPES.MANUAL];
    }

    /**
     * Gets the full source list for saving to backend
     * @param {Object} context - Current editing context (hasAudio, hasPhotos, etc.)
     * @returns {Array<string>} Array of source strings
     */
    function determineSourcesFromContext(context) {
        const sources = [];
        if (context.hasAudio) sources.push(SCOPES.AUDIO);
        if (context.hasPhotos) sources.push(SCOPES.IMAGE);
        if (context.hasPlaceId) sources.push(SCOPES.GOOGLE);
        if (context.isImport) sources.push(SCOPES.IMPORT);

        if (sources.length === 0) sources.push(SCOPES.MANUAL);

        return sources;
    }

    return {
        SCOPES,
        detectSource,
        determineSourcesFromContext
    };
})();

// Expose to window for global access
window.SourceUtils = SourceUtils;
