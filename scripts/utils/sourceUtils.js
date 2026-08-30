/**
 * SourceUtils - Standardized logic for Curation Sources and semantic truth.
 *
 * Provenance, linkage and authorship must come from explicit domain fields.
 * Content and display context are never allowed to reconstruct those facts.
 */
const SourceUtils = (() => {
    const SCOPES = {
        AUDIO: 'audio', IMAGE: 'image', TEXT: 'text', GOOGLE: 'google_places',
        IMPORT: 'import', WEB_RESEARCH: 'web_research', MANUAL: 'manual'
    };

    const UI_CONFIG = {
        [SCOPES.AUDIO]: { label: 'Voice Note', icon: 'mic', className: 'chip chip--accent' },
        [SCOPES.IMAGE]: { label: 'Photo', icon: 'photo_camera', className: 'chip chip--accent' },
        [SCOPES.TEXT]: { label: 'Text Input', icon: 'text_fields', className: 'chip chip--info' },
        [SCOPES.GOOGLE]: { label: 'Google Places', icon: 'place', className: 'chip chip--success' },
        [SCOPES.IMPORT]: { label: 'Imported', icon: 'file_upload', className: 'chip chip--warning' },
        [SCOPES.WEB_RESEARCH]: { label: 'Web Research', icon: 'travel_explore', className: 'chip chip--info' },
        [SCOPES.MANUAL]: { label: 'Manual Entry', icon: 'edit', className: 'chip chip--neutral' }
    };

    function hasMeaningfulId(value) {
        return value !== null && value !== undefined && String(value).trim() !== '';
    }

    function isLinkedCuration(curation) { return hasMeaningfulId(curation?.entity_id); }
    function getCuratorType(curation) { return curation?.curator_type === 'synthetic' ? 'synthetic' : 'human'; }
    function getCuratorIcon(curation) { return getCuratorType(curation) === 'synthetic' ? 'smart_toy' : 'person'; }

    function getEntitySource(entity) {
        const explicit = entity?.data?.source || entity?.source;
        if (explicit && String(explicit).trim()) return String(explicit).trim();
        if (hasMeaningfulId(entity?.data?.place_id) || hasMeaningfulId(entity?.data?.google_place_id) || hasMeaningfulId(entity?.place_id)) {
            return SCOPES.GOOGLE;
        }
        return SCOPES.MANUAL;
    }

    function detectSource(curation, entity) {
        const sources = curation.sources || [];
        if (Array.isArray(sources) && sources.length > 0) {
            for (const scope of [SCOPES.AUDIO, SCOPES.IMAGE, SCOPES.TEXT, SCOPES.GOOGLE, SCOPES.IMPORT, SCOPES.WEB_RESEARCH, SCOPES.MANUAL]) {
                if (sources.includes(scope)) return UI_CONFIG[scope];
            }
            return UI_CONFIG[SCOPES.MANUAL];
        }
        if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
            for (const scope of [SCOPES.AUDIO, SCOPES.IMAGE, SCOPES.TEXT, SCOPES.GOOGLE, SCOPES.IMPORT, SCOPES.WEB_RESEARCH, SCOPES.MANUAL]) {
                if (Array.isArray(sources[scope]) && sources[scope].length > 0) return UI_CONFIG[scope];
            }
            if (Object.keys(sources).length > 0) return UI_CONFIG[SCOPES.MANUAL];
        }
        // Legacy compatibility only when NO explicit provenance exists.
        if ((curation.transcript || curation.unstructured_text || curation.transcription || '').trim().length > 0) return UI_CONFIG[SCOPES.AUDIO];
        if (curation.photos?.length > 0) return UI_CONFIG[SCOPES.IMAGE];
        if (getEntitySource(entity) === SCOPES.GOOGLE || curation.googlePlaceId) return UI_CONFIG[SCOPES.GOOGLE];
        return UI_CONFIG[SCOPES.MANUAL];
    }

    function determineSourcesFromContext(context) {
        const sources = [];
        if (context.hasAudio) sources.push(SCOPES.AUDIO);
        if (context.hasPhotos) sources.push(SCOPES.IMAGE);
        if (context.hasPlaceId) sources.push(SCOPES.GOOGLE);
        if (context.isImport) sources.push(SCOPES.IMPORT);
        if (!sources.length) sources.push(SCOPES.MANUAL);
        return sources;
    }

    function resolveAudioSourceId(context) {
        if (context.audioSourceId !== undefined && context.audioSourceId !== null) return context.audioSourceId;
        if (context.transcriptionId !== undefined && context.transcriptionId !== null) return context.transcriptionId;
        const recorder = window.uiManager?.recordingModule;
        // Stable provenance id wins. Numeric currentAudioId remains a legacy
        // local blob locator fallback for pre-Part-2 runtimes/tests.
        const stableSourceId = recorder?.currentAudioSourceId;
        if (stableSourceId !== undefined && stableSourceId !== null) return stableSourceId;
        const runtimeAudioId = recorder?.currentAudioId;
        return runtimeAudioId !== undefined && runtimeAudioId !== null ? runtimeAudioId : null;
    }

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
                const alreadyRecorded = currentAudio.some((entry) => String(entry?.source_id ?? '') === String(sourceId));
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
        if (context.hasPhotos) sources.image = Array.isArray(sources.image) && sources.image.length ? sources.image : [{ created_at: now }];
        if (context.hasPlaceId) sources.google_places = Array.isArray(sources.google_places) && sources.google_places.length ? sources.google_places : [{ created_at: now }];
        if (context.isImport) sources.import = Array.isArray(sources.import) && sources.import.length ? sources.import : [{ created_at: now }];
        if (!Object.keys(sources).length) sources.manual = [{ created_at: now }];
        return sources;
    }

    function patchCardFactory() {
        const factory = window.CardFactory;
        if (!factory || factory.__semanticTruthGuardsInstalled) return;
        factory.__semanticTruthGuardsInstalled = true;
        if (typeof factory.createEntityCard === 'function') {
            const original = factory.createEntityCard.bind(factory);
            factory.createEntityCard = (entity, options = {}) => {
                const card = original(entity, options);
                const source = getEntitySource(entity);
                const label = card?.querySelector?.('.collection-source-badge__label');
                if (label) label.textContent = source.replace(/_/g, ' ');
                const icon = card?.querySelector?.('.collection-source-badge .material-icons');
                if (icon && source === SCOPES.GOOGLE) icon.textContent = 'place';
                return card;
            };
        }
        if (typeof factory.createCurationCard === 'function') {
            const original = factory.createCurationCard.bind(factory);
            factory.createCurationCard = (entity, curation, options = {}) => {
                const card = original(entity, curation, options);
                const icon = card?.querySelector?.('.collection-card__subtitle .material-icons');
                if (icon) icon.textContent = getCuratorIcon(curation);
                if (getCuratorType(curation) === 'synthetic') card?.classList?.add('collection-card--synthetic-curator');
                return card;
            };
        }
    }

    function patchWorkspaceState() {
        const Workspace = window.CurationWorkspaceModule;
        if (!Workspace || Workspace.__semanticTruthStateInstalled) return;
        Workspace.__semanticTruthStateInstalled = true;
        Workspace.deriveState = (curation = null, entity = null) => {
            const provisionalEntityId = !curation && window.uiManager?.importedEntityId ? window.uiManager.importedEntityId : null;
            const entityId = isLinkedCuration(curation) ? curation.entity_id : provisionalEntityId;
            const linked = hasMeaningfulId(entityId);
            const synthetic = getCuratorType(curation) === 'synthetic';
            const workingName = curation?.restaurant_name || curation?.name || '';
            const canonicalName = linked ? (entity?.name || entity?.restaurant_name || '') : '';
            return {
                linkage: linked ? 'linked' : 'orphan',
                authorship: synthetic ? 'synthetic' : 'human',
                key: `${linked ? 'linked' : 'orphan'}-${synthetic ? 'synthetic' : 'human'}`,
                displayName: linked ? (canonicalName || workingName) : workingName,
                workingName,
                canonicalName,
                entityId: linked ? entityId : null,
                isLinked: linked,
                isSynthetic: synthetic
            };
        };
    }

    function installSemanticTruthGuards() { patchCardFactory(); patchWorkspaceState(); }

    return {
        SCOPES, detectSource, determineSourcesFromContext, buildSourcesPayloadFromContext,
        isLinkedCuration, getCuratorType, getCuratorIcon, getEntitySource, installSemanticTruthGuards
    };
})();

window.SourceUtils = SourceUtils;
SourceUtils.installSemanticTruthGuards();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SourceUtils.installSemanticTruthGuards(), { once: true });
else SourceUtils.installSemanticTruthGuards();
