/*
 * CurationWorkspaceModule
 *
 * Progressive orchestration boundary for the Collector curation editor.
 * Entity remains canonical factual context; Curation remains the curator's
 * editorial knowledge. This module deliberately starts small so legacy
 * recording/concept/save mechanics can migrate behind it without a big bang.
 */
class CurationWorkspaceModule {
    constructor(uiManager = null) {
        this.uiManager = uiManager || window.uiManager || null;
        this.currentCuration = null;
        this.currentEntity = null;
        this.state = CurationWorkspaceModule.deriveState(null, null);
    }

    static deriveState(curation = null, entity = null) {
        const linked = Boolean(curation?.entity_id || entity?.entity_id);
        const synthetic = curation?.curator_type === 'synthetic';
        const linkage = linked ? 'linked' : 'orphan';
        const authorship = synthetic ? 'synthetic' : 'human';
        const workingName = curation?.restaurant_name || curation?.name || '';
        const canonicalName = entity?.name || entity?.restaurant_name || '';
        const displayName = linked
            ? (canonicalName || workingName)
            : workingName;

        return {
            linkage,
            authorship,
            key: `${linkage}-${authorship}`,
            displayName,
            workingName,
            canonicalName,
            entityId: curation?.entity_id || entity?.entity_id || null,
            isLinked: linked,
            isSynthetic: synthetic
        };
    }

    async refresh({ curation = null, entity = null } = {}) {
        this.currentCuration = curation;
        this.currentEntity = entity;
        this.state = CurationWorkspaceModule.deriveState(curation, entity);
        return this.state;
    }
}

window.CurationWorkspaceModule = CurationWorkspaceModule;
