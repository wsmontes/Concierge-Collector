/*
 * OfflineSaveCoordinator
 *
 * The legacy authoring save is composed from compatibility wrappers that
 * temporarily expose per-save state on shared runtime objects, including
 * short-lived monkeypatches of DataStore.db.curations.put. Those wrappers are
 * safe only when every independent local Curation writer stays outside that
 * window. This coordinator is therefore the tab-local Curation mutation gate,
 * not merely a double-click guard for saveRestaurant().
 *
 * IMPORTANT: only top-level independent writers are registered here. The
 * ConceptModule.saveRestaurant implementation itself is already inside the
 * outer save lock and must never try to acquire the same non-reentrant FIFO
 * again from its internal put().
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
            this._writerTimer = null;
        }

        runExclusive(task) {
            if (typeof task !== 'function') return Promise.reject(new TypeError('Coordinator task must be a function'));
            const run = this._tail.then(() => task());
            // A rejected mutation must not poison the queue. Callers still
            // receive the original rejection from `run`, while later work
            // waits for a settled tail and then continues normally.
            this._tail = run.catch(() => undefined);
            return run;
        }

        runCurationMutation(task) {
            return this.runExclusive(task);
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
            conceptModule.saveRestaurant = (...args) => coordinator.runCurationMutation(
                () => originalSave(...args)
            );

            this._installed = true;
            return true;
        }

        _wrapCurationWriter(target, methodName, label) {
            const current = target?.[methodName];
            if (typeof current !== 'function') return false;
            if (current.__offlineSaveCoordinatorOwner === this) return false;

            const coordinator = this;
            const original = current.bind(target);
            const wrapped = function offlineSaveCoordinatorWriter(...args) {
                return coordinator.runCurationMutation(() => original(...args));
            };
            wrapped.__offlineSaveCoordinatorOwner = this;
            wrapped.__offlineSaveCoordinatorOriginal = current;
            wrapped.__offlineSaveCoordinatorLabel = label;
            target[methodName] = wrapped;
            return true;
        }

        _knownCurationWriterSpecs() {
            const uiManager = this.runtime.uiManager;
            return [
                [this.runtime.offlineCaptureProcessor, 'materializeIntoCuration', 'audio materialization'],
                // OfflinePhotoLeaseGuard is installed before this module. By
                // wrapping the final materialize() here, FIFO acquisition is
                // outside its Dexie RW transaction: never wait for the save
                // queue while holding an IndexedDB write transaction.
                [this.runtime.offlinePhotoProcessor, 'materialize', 'photo materialization'],
                // processServerCuration performs local reads/writes only. The
                // network page fetch happens in pullCurations before this call,
                // so the Curation gate is never held across HTTP.
                [this.runtime.SyncManager, 'processServerCuration', 'sync pull materialization'],
                [uiManager, 'updateCurationStatus', 'workflow status mutation'],
                [uiManager, 'linkReviewToEntity', 'entity link mutation'],
                [uiManager, 'unlinkCurationFromEntity', 'entity unlink mutation'],
                // Listener was removed in favor of ConceptModule.saveRestaurant,
                // but keep the legacy public saver safe if an old caller still
                // invokes it directly.
                [uiManager?.restaurantModule, 'handleSave', 'legacy restaurant saver'],
                // ImportManager is a singleton in production; some tests/old
                // integrations expose the same object under importManager.
                [this.runtime.importManager || this.runtime.ImportManager, 'importV3Data', 'v3 bulk import'],
                // Legacy Concierge-format import writes many local Curations
                // through DataStore. Serialize the whole local import method;
                // its caller performs file IO and post-import sync outside it.
                [this.runtime.DataStore, 'importConciergeData', 'legacy bulk import']
            ];
        }

        installKnownCurationWriters() {
            let installed = 0;
            for (const [target, methodName, label] of this._knownCurationWriterSpecs()) {
                if (this._wrapCurationWriter(target, methodName, label)) installed += 1;
            }
            return installed;
        }

        _allKnownWritersAvailable() {
            const specs = this._knownCurationWriterSpecs();
            // Optional legacy/import paths may legitimately be absent in a
            // stripped build. The five always-live boundaries below are the
            // ones that can race automatically with an editor save.
            const required = specs.slice(0, 6);
            return required.every(([target, methodName]) =>
                typeof target?.[methodName] === 'function' &&
                target[methodName].__offlineSaveCoordinatorOwner === this
            );
        }

        _pollWriterInstall(attempt = 0) {
            this.installKnownCurationWriters();
            if (this._allKnownWritersAvailable()) return;
            if (attempt >= 300) {
                this.log.warn('Curation writer coordinator could not attach to every live writer');
                return;
            }
            clearTimeout(this._writerTimer);
            this._writerTimer = this.runtime.setTimeout?.(() => this._pollWriterInstall(attempt + 1), 100);
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
            this._pollWriterInstall();
            return this;
        }
    }

    global.OfflineSaveCoordinator = OfflineSaveCoordinator;
    if (global.document && !global.offlineSaveCoordinator) {
        global.offlineSaveCoordinator = new OfflineSaveCoordinator(global).start();
    }
})(window);
