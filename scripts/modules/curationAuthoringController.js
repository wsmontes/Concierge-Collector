/*
 * CurationAuthoringController
 *
 * Convergence boundary for the progressive legacy editor migration. Durability
 * and ownership used to wrap UIManager.editCuration independently and depended
 * on installation order. This controller becomes the single outer edit entry
 * while reusing those modules as explicit collaborators.
 */
(function exposeCurationAuthoringController(global) {
    'use strict';

    class CurationAuthoringController {
        constructor() {
            this.log = global.Logger?.module?.('CurationAuthoringController') || console;
            this._installed = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            const uiManager = global.uiManager;
            const ready = Boolean(
                uiManager?.editCuration &&
                uiManager?.__offlineDurabilityEditRestoreInstalled &&
                uiManager?.__offlineOwnershipGuardInstalled &&
                global.offlineDurability?.restoreDraftForTarget &&
                global.offlineOwnership?.startIndependentCuration &&
                global.CurationOwnershipPolicy?.decide
            );

            if (ready) {
                this.install(uiManager);
                return;
            }
            if (attempt >= 300) {
                this.log.warn('Authoring controller could not attach to the editor');
                return;
            }
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollInstall(attempt + 1), 100);
        }

        install(uiManager = global.uiManager) {
            if (!uiManager?.editCuration || this._installed || uiManager.__curationAuthoringControllerInstalled) {
                return false;
            }

            // OfflineDurability captured the mutable editor before either
            // durability restore or ownership policy wrapped it. Reusing that
            // explicit pointer collapses the historical wrapper chain without
            // changing the legacy UIManager API.
            const baseEdit = uiManager.__offlineDurabilityOriginalEditCuration;
            if (typeof baseEdit !== 'function') {
                this.log.warn('Base edit boundary is unavailable; preserving legacy wrappers');
                return false;
            }

            uiManager.__curationAuthoringControllerInstalled = true;
            uiManager.__curationAuthoringBaseEditCuration = baseEdit;
            const controller = this;

            uiManager.editCuration = async (curation, ...args) => {
                const editorId = global.offlineOwnership.currentCuratorId(uiManager);
                const decision = global.CurationOwnershipPolicy.decide(curation, editorId);

                if (decision.action === 'create-own') {
                    return global.offlineOwnership.startIndependentCuration(curation, decision, uiManager);
                }

                // Synthetic takeover is still write-triggered. Merely opening
                // the editor never mutates ownership.
                const result = await baseEdit(curation, ...args);
                await global.offlineDurability.restoreDraftForTarget(curation, uiManager);
                return result;
            };

            this._installed = true;
            return true;
        }
    }

    global.CurationAuthoringController = CurationAuthoringController;
    if (!global.curationAuthoringController) {
        global.curationAuthoringController = new CurationAuthoringController();
        global.curationAuthoringController.start();
    }
})(window);
