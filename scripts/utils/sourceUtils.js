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
        WEB_RESEARCH: 'web_research',
        MANUAL: 'manual'
    };

    // 2. Define UI Mappings (Frontend Representation)
    const UI_CONFIG = {
        [SCOPES.AUDIO]: {
            label: 'Voice Note',
            icon: 'mic',
            className: 'chip chip--accent'
        },
        [SCOPES.IMAGE]: {
            label: 'Photo',
            icon: 'photo_camera',
            className: 'chip chip--accent'
        },
        [SCOPES.TEXT]: {
            label: 'Text Input',
            icon: 'text_fields',
            className: 'chip chip--info'
        },
        [SCOPES.GOOGLE]: {
            label: 'Google Places',
            icon: 'place',
            className: 'chip chip--success'
        },
        [SCOPES.IMPORT]: {
            label: 'Imported',
            icon: 'file_upload',
            className: 'chip chip--warning'
        },
        [SCOPES.WEB_RESEARCH]: {
            label: 'Web Research',
            icon: 'travel_explore',
            className: 'chip chip--info'
        },
        [SCOPES.MANUAL]: {
            label: 'Manual Entry',
            icon: 'edit',
            className: 'chip chip--neutral'
        }
    };

    /**
     * Detects the primary source of a curation based on its provenance.
     * Explicit source metadata always wins over content heuristics.
     * Priority: Audio > Image > Text > Google > Import > Web Research > Manual.
     *
     * A transcript is not proof of audio: synthetic web research also stores
     * research material in the transcript field. Transcript-as-audio therefore
     * exists only as a compatibility fallback for legacy records that have no
     * explicit source provenance at all.
     */
    function detectSource(curation, entity) {
        const sources = curation.sources || [];

        if (Array.isArray(sources) && sources.length > 0) {
            if (sources.includes(SCOPES.AUDIO)) return UI_CONFIG[SCOPES.AUDIO];
            if (sources.includes(SCOPES.IMAGE)) return UI_CONFIG[SCOPES.IMAGE];
            if (sources.includes(SCOPES.TEXT)) return UI_CONFIG[SCOPES.TEXT];
            if (sources.includes(SCOPES.GOOGLE)) return UI_CONFIG[SCOPES.GOOGLE];
            if (sources.includes(SCOPES.IMPORT)) return UI_CONFIG[SCOPES.IMPORT];
            if (sources.includes(SCOPES.WEB_RESEARCH)) return UI_CONFIG[SCOPES.WEB_RESEARCH];
            if (sources.includes(SCOPES.MANUAL)) return UI_CONFIG[SCOPES.MANUAL];
            return UI_CONFIG[SCOPES.MANUAL];
        }

        if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
            if (Array.isArray(sources.audio) && sources.audio.length > 0) return UI_CONFIG[SCOPES.AUDIO];
            if (Array.isArray(sources.image) && sources.image.length > 0) return UI_CONFIG[SCOPES.IMAGE];
            if (Array.isArray(sources.text) && sources.text.length > 0) return UI_CONFIG[SCOPES.TEXT];
            if (Array.isArray(sources.google_places) && sources.google_places.length > 0) return UI_CONFIG[SCOPES.GOOGLE];
            if (Array.isArray(sources.import) && sources.import.length > 0) return UI_CONFIG[SCOPES.IMPORT];
            if (Array.isArray(sources.web_research) && sources.web_research.length > 0) return UI_CONFIG[SCOPES.WEB_RESEARCH];
            if (Array.isArray(sources.manual) && sources.manual.length > 0) return UI_CONFIG[SCOPES.MANUAL];

            if (Object.keys(sources).length > 0) return UI_CONFIG[SCOPES.MANUAL];
        }

        // Compatibility fallback only for truly unstructured legacy records.
        if ((curation.transcript || curation.unstructured_text || curation.transcription || '').trim().length > 0) {
            return UI_CONFIG[SCOPES.AUDIO];
        }

        if (curation.photos && curation.photos.length > 0) {
            return UI_CONFIG[SCOPES.IMAGE];
        }

        if (entity?.data?.place_id || entity?.data?.google_place_id || entity?.place_id || curation.googlePlaceId) {
            return UI_CONFIG[SCOPES.GOOGLE];
        }

        return UI_CONFIG[SCOPES.MANUAL];
    }

    function determineSourcesFromContext(context) {
        const sources = [];
        if (context.hasAudio) sources.push(SCOPES.AUDIO);
        if (context.hasPhotos) sources.push(SCOPES.IMAGE);
        if (context.hasPlaceId) sources.push(SCOPES.GOOGLE);
        if (context.isImport) sources.push(SCOPES.IMPORT);

        if (sources.length === 0) sources.push(SCOPES.MANUAL);
        return sources;
    }

    /**
     * Build structured source payload for curation persistence.
     * Existing provenance is immutable history: new capture events append;
     * saving text never reconstructs provenance from the transcript body.
     */
    function buildSourcesPayloadFromContext(context) {
        const now = new Date().toISOString();
        const existing = (context.existingSources && typeof context.existingSources === 'object' && !Array.isArray(context.existingSources))
            ? { ...context.existingSources }
            : {};

        const sources = { ...existing };

        if (context.hasAudio) {
            const currentAudio = Array.isArray(sources.audio) ? [...sources.audio] : [];
            const sourceId = context.audioSourceId ?? context.transcriptionId ?? null;
            const alreadyRecorded = sourceId != null && currentAudio.some((entry) => {
                if (!entry || typeof entry !== 'object') return false;
                return String(entry.source_id ?? '') === String(sourceId);
            });

            if (!alreadyRecorded) {
                currentAudio.push({
                    source_id: sourceId,
                    transcript: context.transcript || null,
                    language: context.language || null,
                    model: context.model || null,
                    duration_seconds: context.durationSeconds || null,
                    created_at: now
                });
            }
            sources.audio = currentAudio;
        }

        if (context.hasPhotos) {
            sources.image = sources.image && Array.isArray(sources.image) && sources.image.length > 0
                ? sources.image
                : [{ created_at: now }];
        }

        if (context.hasPlaceId) {
            sources.google_places = sources.google_places && Array.isArray(sources.google_places) && sources.google_places.length > 0
                ? sources.google_places
                : [{ created_at: now }];
        }

        if (context.isImport) {
            sources.import = sources.import && Array.isArray(sources.import) && sources.import.length > 0
                ? sources.import
                : [{ created_at: now }];
        }

        if (Object.keys(sources).length === 0) {
            sources.manual = [{ created_at: now }];
        }

        return sources;
    }

    return {
        SCOPES,
        detectSource,
        determineSourcesFromContext,
        buildSourcesPayloadFromContext
    };
})();

window.SourceUtils = SourceUtils;
