/*
 * OfflineKnownLinkageGuard
 *
 * `entity_id` is linkage truth. A locally known relation must survive Save
 * even when the canonical Entity document is not present in this device's
 * working set. This narrow Save boundary avoids manufacturing a placeholder
 * Entity merely to satisfy legacy ConceptModule branching.
 */
(function exposeOfflineKnownLinkageGuard(global) {
    'use strict';

    class OfflineKnownLinkageGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineKnownLinkageGuard') || console;
            this._installed = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Known-linkage Save guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollInstall(attempt + 1), 100);
        }

        install() {
            const uiManager = this.runtime.uiManager;
            const conceptModule = uiManager?.conceptModule;
            const table = this.runtime.DataStore?.db?.curations;
            if (!conceptModule?.saveRestaurant || !table?.put) return false;
            if (this._installed || conceptModule.__offlineKnownLinkageGuardInstalled) {
                this._installed = true;
                return true;
            }

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            const guard = this;
            conceptModule.__offlineKnownLinkageGuardInstalled = true;
            conceptModule.__offlineKnownLinkageOriginalSaveRestaurant = originalSave;

            conceptModule.saveRestaurant = async (...args) => {
                const knownEntityId = uiManager.importedEntityId || null;
                const canonicalEntityCached = Boolean(uiManager.importedEntityData);

                // The normal path already carries entity_id through the legacy
                // editor. Intercept only the relation-only offline case.
                if (!knownEntityId || canonicalEntityCached) {
                    return originalSave(...args);
                }

                const originalPut = table.put;
                table.put = async (curation, ...putArgs) => {
                    if (curation && !curation.entity_id) {
                        curation.entity_id = knownEntityId;
                        // Linkage is not workflow. Never manufacture `linked`.
                        if (!curation.status || curation.status === 'linked') {
                            curation.status = 'draft';
                        }
                    }
                    return originalPut.call(table, curation, ...putArgs);
                };

                try {
                    return await originalSave(...args);
                } finally {
                    table.put = originalPut;
                }
            };

            this._installed = true;
            return true;
        }
    }

    global.OfflineKnownLinkageGuard = OfflineKnownLinkageGuard;
    if (global.document && !global.offlineKnownLinkageGuard) {
        global.offlineKnownLinkageGuard = new OfflineKnownLinkageGuard(global).start();
    }
})(window);
