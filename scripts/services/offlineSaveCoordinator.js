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
            const syncManager = this.runtime.SyncManager;
            const dataStore = this.runtime.DataStore;
            return [
                [this.runtime.offlineCaptureProcessor, 'materializeIntoCuration', 'audio materialization'],
                // OfflinePhotoLeaseGuard is installed before this module. By
                // wrapping the final materialize() here, FIFO acquisition is
                // outside its Dexie RW transaction: never wait for the save
                // queue while holding an IndexedDB write transaction.
                [this.runtime.offlinePhotoProcessor, 'materialize', 'photo materialization'],
                // Pull: network paging happens before processServerCuration;
                // the wrapped method itself is local reads/writes only.
                [syncManager, 'processServerCuration', 'sync pull materialization'],
                // Push does contain HTTP. Keeping the whole push behind the
                // compatibility gate is deliberately conservative: its local
                // status/_lastSyncedState writes otherwise race an editor put.
                // This can be narrowed when SyncManager exposes explicit local
                // commit callbacks instead of writing Dexie inline.
                [syncManager, 'pushCurations', 'sync push reconciliation'],
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
                // through DataStore.createCuration. Serialize the outer import,
                // not createCuration itself, because wrapping both would make
                // this non-reentrant FIFO self-deadlock.
                [dataStore, 'importConciergeData', 'legacy bulk import'],
                // Entity deletion soft-deletes linked Curations locally.
                [dataStore, 'deleteEntity', 'entity cascade curation mutation'],
                [dataStore, 'deleteCuration', 'curation soft delete'],
                // Old Places/UI compatibility flow creates a Curation through
                // DataStore.createCuration; protect the top-level caller only.
                [this.runtime.dataStorage, 'saveRestaurantWithAutoSync', 'legacy compatibility save']
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
            // These are the always-live runtime boundaries that can be kicked
            // by reconnect/background work or normal editor/list UI. Import and
            // legacy compatibility writers remain opportunistically wrapped.
            const requiredIndexes = [0, 1, 2, 3, 4, 5, 6];
            return requiredIndexes.every((index) => {
                const [target, methodName] = specs[index];
                return typeof target?.[methodName] === 'function' &&
                    target[methodName].__offlineSaveCoordinatorOwner === this;
            });
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
            if (this.wrappersReady(conceptModule) && this.install()) {
                // Do not expose coordinated external writers before the save
                // itself owns this same FIFO. Otherwise an early writer could
                // be queued while saveRestaurant is still entering unguarded.
                this._pollWriterInstall();
                return;
            }
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
