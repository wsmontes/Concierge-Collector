/**
 * SourceUtils - Standardized logic for Curation Sources and semantic truth.
 *
 * Provenance, linkage and authorship must come from explicit domain fields.
 * Content and display context are never allowed to reconstruct those facts.
 */

const SourceUtils = (() => {
    const SCOPES = {
        AUDIO: 'audio',
        IMAGE: 'image',
        TEXT: 'text',
        GOOGLE: 'google_places',
        IMPORT: 'import',
        WEB_RESEARCH: 'web_research',
        MANUAL: 'manual'
    };

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

    function hasMeaningfulId(value) {
        return value !== null && value !== undefined && String(value).trim() !== '';
    }

    /** Linkage truth: persisted Curation.entity_id only. */
    function isLinkedCuration(curation) {
        return hasMeaningfulId(curation?.entity_id);
    }

    /** Authorship truth: explicit curator_type; legacy absence defaults human. */
    function getCuratorType(curation) {
        return curation?.curator_type === 'synthetic' ? 'synthetic' : 'human';
    }

    function getCuratorIcon(curation) {
        return getCuratorType(curation) === 'synthetic' ? 'smart_toy' : 'person';
    }

    /** Entity provenance truth with shape-compatible Google Places ids. */
    function getEntitySource(entity) {
        const explicit = entity?.data?.source || entity?.source;
        if (explicit && String(explicit).trim()) return String(explicit).trim();
        if (
            hasMeaningfulId(entity?.data?.place_id) ||
            hasMeaningfulId(entity?.data?.google_place_id) ||
            hasMeaningfulId(entity?.place_id)
        ) {
            return SCOPES.GOOGLE;
        }
        return SCOPES.MANUAL;
    }

    /**
     * Detects the primary source of a curation based on provenance.
     * Explicit source metadata always wins over content heuristics.
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

            // Unknown-but-explicit provenance must never be reinterpreted as audio.
            if (Object.keys(sources).length > 0) return UI_CONFIG[SCOPES.MANUAL];
        }

        // Compatibility fallback only for truly unstructured legacy records.
        if ((curation.transcript || curation.unstructured_text || curation.transcription || '').trim().length > 0) {
            return UI_CONFIG[SCOPES.AUDIO];
        }

        if (curation.photos && curation.photos.length > 0) {
            return UI_CONFIG[SCOPES.IMAGE];
        }

        if (getEntitySource(entity) === SCOPES.GOOGLE || curation.googlePlaceId) {
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

    function resolveAudioSourceId(context) {
        if (context.audioSourceId !== undefined && context.audioSourceId !== null) {
            return context.audioSourceId;
        }
        if (context.transcriptionId !== undefined && context.transcriptionId !== null) {
            return context.transcriptionId;
        }
        const runtimeAudioId = window.uiManager?.recordingModule?.currentAudioId;
        return runtimeAudioId !== undefined && runtimeAudioId !== null ? runtimeAudioId : null;
    }

    /**
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
            const sourceId = resolveAudioSourceId(context);
            if (sourceId !== null) {
                const currentAudio = Array.isArray(sources.audio) ? [...sources.audio] : [];
                const alreadyRecorded = currentAudio.some((entry) => {
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

    function patchCardFactory() {
        const factory = window.CardFactory;
        if (!factory || factory.__semanticTruthGuardsInstalled) return;
        factory.__semanticTruthGuardsInstalled = true;

        if (typeof factory.createEntityCard === 'function') {
            const originalCreateEntityCard = factory.createEntityCard.bind(factory);
            factory.createEntityCard = (entity, options = {}) => {
                const card = originalCreateEntityCard(entity, options);
                const source = getEntitySource(entity);
                const label = card?.querySelector?.('.collection-source-badge__label');
                if (label) label.textContent = source.replace(/_/g, ' ');
                const icon = card?.querySelector?.('.collection-source-badge .material-icons');
                if (icon && source === SCOPES.GOOGLE) icon.textContent = 'place';
                return card;
            };
        }

        if (typeof factory.createCurationCard === 'function') {
            const originalCreateCurationCard = factory.createCurationCard.bind(factory);
            factory.createCurationCard = (entity, curation, options = {}) => {
                const card = originalCreateCurationCard(entity, curation, options);
                const curatorIcon = card?.querySelector?.('.collection-card__subtitle .material-icons');
                if (curatorIcon) curatorIcon.textContent = getCuratorIcon(curation);
                if (getCuratorType(curation) === 'synthetic') {
                    card?.classList?.add('collection-card--synthetic-curator');
                }
                return card;
            };
        }
    }

    function patchWorkspaceState() {
        const Workspace = window.CurationWorkspaceModule;
        if (!Workspace || Workspace.__semanticTruthStateInstalled) return;
        Workspace.__semanticTruthStateInstalled = true;

        Workspace.deriveState = (curation = null, entity = null) => {
            // A supplied Entity is context, not linkage. The only exception is
            // a brand-new Curation explicitly started from an Entity, where the
            // UIManager carries importedEntityId as provisional linkage intent.
            const provisionalEntityId = !curation && window.uiManager?.importedEntityId
                ? window.uiManager.importedEntityId
                : null;
            const entityId = isLinkedCuration(curation)
                ? curation.entity_id
                : provisionalEntityId;
            const linked = hasMeaningfulId(entityId);
            const synthetic = getCuratorType(curation) === 'synthetic';
            const linkage = linked ? 'linked' : 'orphan';
            const authorship = synthetic ? 'synthetic' : 'human';
            const workingName = curation?.restaurant_name || curation?.name || '';
            const canonicalName = linked ? (entity?.name || entity?.restaurant_name || '') : '';
            const displayName = linked ? (canonicalName || workingName) : workingName;

            return {
                linkage,
                authorship,
                key: `${linkage}-${authorship}`,
                displayName,
                workingName,
                canonicalName,
                entityId: linked ? entityId : null,
                isLinked: linked,
                isSynthetic: synthetic
            };
        };
    }

    function installSemanticTruthGuards() {
        patchCardFactory();
        patchWorkspaceState();
    }

    return {
        SCOPES,
        detectSource,
        determineSourcesFromContext,
        buildSourcesPayloadFromContext,
        isLinkedCuration,
        getCuratorType,
        getCuratorIcon,
        getEntitySource,
        installSemanticTruthGuards
    };
})();

window.SourceUtils = SourceUtils;

// CardFactory is already loaded when SourceUtils executes. Workspace loads
// later; registering now means this listener runs before Workspace.bootstrap's
// later DOMContentLoaded listener, so the state contract is patched first.
SourceUtils.installSemanticTruthGuards();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SourceUtils.installSemanticTruthGuards(), { once: true });
} else {
    SourceUtils.installSemanticTruthGuards();
}
