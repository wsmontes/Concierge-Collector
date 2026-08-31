/*
 * OfflineSaveCoordinator
 *
 * The legacy authoring save is composed from compatibility wrappers that
 * temporarily expose per-save state on shared runtime objects. Those wrappers
 * are safe only when the complete composed chain is entered by one save at a
 * time. This module is loaded last and installs the outermost FIFO boundary.
 */
(function exposeOfflineSaveCoordinator(global) {
    'use strict';

    class OfflineSaveCoordinator {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineSaveCoordinator') || console;
            this._tail = Promise.resolve();
            this._installed = false;
            this._timer = null;
        }

        runExclusive(task) {
            if (typeof task !== 'function') return Promise.reject(new TypeError('Save task must be a function'));
            const run = this._tail.then(() => task());
            // A rejected save must not poison the queue. Callers still receive
            // the original rejection from `run`, while later saves wait for a
            // settled tail and then continue normally.
            this._tail = run.catch(() => undefined);
            return run;
        }

        wrappersReady(conceptModule = this.runtime.uiManager?.conceptModule) {
            if (!conceptModule?.saveRestaurant) return false;
            return conceptModule.__offlineDurabilitySaveInstalled === true &&
                conceptModule.__offlineCaptureSaveInstalled === true &&
                conceptModule.__offlineSourceIdentityBridgeInstalled === true &&
                conceptModule.__offlineKnownLinkageGuardInstalled === true;
        }

        install(uiManager = this.runtime.uiManager) {
            const conceptModule = uiManager?.conceptModule;
            if (!conceptModule?.saveRestaurant) return false;
            if (this._installed || conceptModule.__offlineSaveCoordinatorInstalled) {
                this._installed = true;
                return true;
            }

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            const coordinator = this;
            conceptModule.__offlineSaveCoordinatorInstalled = true;
            conceptModule.__offlineSaveCoordinatorOriginalSaveRestaurant = originalSave;
            conceptModule.saveRestaurant = (...args) => coordinator.runExclusive(
                () => originalSave(...args)
            );

            this._installed = true;
            return true;
        }

        _pollInstall(attempt = 0) {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (this.wrappersReady(conceptModule) && this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Save coordinator could not attach after all compatibility wrappers');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        start() {
            this._pollInstall();
            return this;
        }
    }

    global.OfflineSaveCoordinator = OfflineSaveCoordinator;
    if (global.document && !global.offlineSaveCoordinator) {
        global.offlineSaveCoordinator = new OfflineSaveCoordinator(global).start();
    }
})(window);
