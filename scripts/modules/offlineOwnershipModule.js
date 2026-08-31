/*
 * OfflineOwnershipModule
 *
 * Prevents a curator from doing offline work against another human's
 * Curation only to receive a 403 after reconnect. The decision is made from
 * durable local ownership metadata before the mutable editor path starts.
 */
(function exposeOfflineOwnership(global) {
    'use strict';

    class OfflineOwnershipModule {
        constructor() {
            this.log = global.Logger?.module?.('OfflineOwnership') || console;
            this._installed = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            const uiManager = global.uiManager;
            // OfflineDurability owns draft restore. Install AFTER it so this
            // policy is the outermost edit boundary and blocked edits never
            // create/restore a mutable draft for somebody else's Curation.
            const durabilityReady = uiManager?.__offlineDurabilityEditRestoreInstalled === true;
            if (uiManager?.editCuration && global.CurationOwnershipPolicy && durabilityReady) {
                this.installOwnershipGuard(uiManager);
                return;
            }

            if (attempt >= 300) {
                this.log.warn('Ownership guard could not attach to the editor');
                return;
            }
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollInstall(attempt + 1), 100);
        }

        currentCuratorId(uiManager = global.uiManager) {
            const profile = global.CuratorProfile?.getCurrentCurator?.();
            return profile?.curator_id ||
                uiManager?.currentCurator?.curator_id ||
                uiManager?.currentCurator?.id ||
                global.AuthService?.getCurrentUser?.()?.email ||
                null;
        }

        installOwnershipGuard(uiManager = global.uiManager) {
            if (!uiManager?.editCuration || this._installed || uiManager.__offlineOwnershipGuardInstalled) return false;

            const originalEdit = uiManager.editCuration.bind(uiManager);
            const module = this;
            uiManager.__offlineOwnershipGuardInstalled = true;
            uiManager.__offlineOwnershipOriginalEditCuration = originalEdit;

            uiManager.editCuration = async (curation, ...args) => {
                const editorId = module.currentCuratorId(uiManager);
                const decision = global.CurationOwnershipPolicy.decide(curation, editorId);

                if (decision.action === 'create-own') {
                    return module.startIndependentCuration(curation, decision, uiManager);
                }

                // `takeover` intentionally enters the normal editor. The
                // existing save compatibility layer transfers synthetic
                // authorship only when the human actually saves an edit.
                return originalEdit(curation, ...args);
            };

            this._installed = true;
            return true;
        }

        async confirmCreateOwn(curation, decision) {
            const ownerName = curation?.curator?.name || decision?.ownerId || 'another curator';
            const message = `This Curation belongs to ${ownerName}. Create your own independent Curation for this place instead?`;

            if (global.uiUtils?.confirmDialog) {
                return Boolean(await global.uiUtils.confirmDialog(
                    'Create your own Curation?',
                    message,
                    'Create mine',
                    'Cancel'
                ));
            }
            if (typeof global.confirm === 'function') return global.confirm(message);
            return false;
        }

        async resolveLocalEntity(entityId) {
            if (!entityId) return null;
            try {
                return await global.DataStore?.db?.entities
                    ?.where('entity_id')
                    ?.equals(entityId)
                    ?.first();
            } catch (error) {
                this.log.warn('Could not resolve linked Entity locally:', error);
                return null;
            }
        }

        notify(message, type = 'info') {
            if (global.uiUtils?.showNotification) return global.uiUtils.showNotification(message, type);
            return global.uiManager?.showNotification?.(message, type);
        }

        async startIndependentCuration(curation, decision, uiManager = global.uiManager) {
            const confirmed = await this.confirmCreateOwn(curation, decision);
            if (!confirmed) return false;

            // `curation.entity_id` is itself durable linkage truth. The Entity
            // document is useful context but is NOT required to author offline.
            // If it is not cached, preserve the known relation and use the
            // Curation's working name until canonical Entity facts are available.
            const intendedEntityId = curation?.entity_id || null;
            const entity = intendedEntityId ? await this.resolveLocalEntity(intendedEntityId) : null;

            const workspace = global.curationWorkspace;
            if (!workspace?.prepareNewCurationState) {
                this.notify('New Curation workspace is not available', 'error');
                return false;
            }

            // Important: no write to the original Curation occurs here.
            workspace.prepareNewCurationState();

            if (intendedEntityId) {
                uiManager.importedEntityId = intendedEntityId;
                uiManager.importedEntityData = entity || null;
            }
            if (uiManager.restaurantModule) {
                uiManager.restaurantModule.currentEntity = entity || null;
                uiManager.restaurantModule.currentCuration = null;
            }

            const workingName = entity?.name || curation?.restaurant_name || curation?.name || '';
            const nameInput = global.document?.getElementById('restaurant-name');
            if (nameInput) nameInput.value = workingName;

            await workspace.refresh?.({ curation: null, entity: entity || null });
            uiManager.formIsDirty = true;
            await uiManager.conceptModule?.autoSaveDraft?.();

            this.notify(
                workingName
                    ? `New Curation started for ${workingName}`
                    : 'New independent Curation started',
                'info'
            );
            return { action: 'create-own', entityId: intendedEntityId };
        }
    }

    global.OfflineOwnershipModule = OfflineOwnershipModule;
    if (!global.offlineOwnership) {
        global.offlineOwnership = new OfflineOwnershipModule();
        global.offlineOwnership.start();
    }
})(window);
