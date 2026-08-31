/*
 * OfflinePhotoLeaseGuard
 *
 * OfflinePhotoProcessor historically used an in-memory single-flight flag and
 * read/modify/write updates of draft.photoProcessing. IndexedDB is shared by
 * tabs, so those guarantees were process-local only. This focused guard adds
 * persistent per-source leases and transactional state/materialization updates
 * without rewriting the photo analysis pipeline.
 */
(function exposeOfflinePhotoLeaseGuard(global) {
    'use strict';

    class OfflinePhotoLeaseGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflinePhotoLeaseGuard') || console;
            this.processingLeaseMs = 5 * 60 * 1000;
            this.processingOwnerId = this._newOwnerId();
            this._installed = false;
            this._timer = null;
        }

        _newOwnerId() {
            try { if (this.runtime.crypto?.randomUUID) return `tab_${this.runtime.crypto.randomUUID()}`; } catch (_) {}
            return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }

        _newToken() {
            try { if (this.runtime.crypto?.randomUUID) return this.runtime.crypto.randomUUID(); } catch (_) {}
            return `photo_lease_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }

        _leaseExpiryMs(state) {
            if (!state?.processingLeaseExpiresAt) return 0;
            const value = new Date(state.processingLeaseExpiresAt).getTime();
            return Number.isFinite(value) ? value : 0;
        }

        _leaseIsActive(state, now = Date.now()) {
            return Boolean(state?.processingLeaseToken && this._leaseExpiryMs(state) > now);
        }

        _leaseLostError() {
            const error = new Error('Offline photo processing lease was lost');
            error.name = 'ProcessingLeaseLostError';
            return error;
        }

        async _withDraftTransaction(task) {
            const db = this.runtime.DataStore?.db;
            const table = db?.draftRestaurants;
            if (!table) throw new Error('Draft storage is not available for photo processing');
            if (typeof db.transaction === 'function') return db.transaction('rw', table, task);
            return task();
        }

        async _withMaterializationTransaction(task) {
            const db = this.runtime.DataStore?.db;
            const drafts = db?.draftRestaurants;
            const curations = db?.curations;
            if (!drafts) throw new Error('Draft storage is not available for photo materialization');
            // A write transaction touching both stores is deliberately broad:
            // two different photos may own different source leases yet still
            // target the same draft/Curation. IndexedDB serializes overlapping
            // RW transactions, preventing read-modify-write lost updates.
            if (typeof db.transaction === 'function' && curations) {
                return db.transaction('rw', drafts, curations, task);
            }
            if (typeof db.transaction === 'function') return db.transaction('rw', drafts, task);
            return task();
        }

        _stateForLease(row, lease) {
            return row?.photoProcessing?.[lease?.sourceId] || null;
        }

        async _assertLeaseDirect(lease) {
            if (!lease) throw this._leaseLostError();
            const row = await this.runtime.DataStore.db.draftRestaurants.get(lease.draftId);
            const state = this._stateForLease(row, lease);
            if (!state || state.processingLeaseToken !== lease.token || !this._leaseIsActive(state)) {
                throw this._leaseLostError();
            }
            return true;
        }

        async _transactionalUpdate(draftId, updater, activeLease = null) {
            return this._withDraftTransaction(async () => {
                const table = this.runtime.DataStore.db.draftRestaurants;
                const raw = await table.get(draftId);
                if (!raw) return null;
                const current = raw.photoProcessing && typeof raw.photoProcessing === 'object'
                    ? { ...raw.photoProcessing }
                    : {};

                if (activeLease && activeLease.draftId === draftId) {
                    const state = current[activeLease.sourceId];
                    if (!state || state.processingLeaseToken !== activeLease.token || !this._leaseIsActive(state)) {
                        throw this._leaseLostError();
                    }
                }

                const next = await updater(current, raw);
                await table.update(draftId, {
                    photoProcessing: next || current,
                    lastModified: new Date()
                });
                return next || current;
            });
        }

        async claim(draftId, sourceId, { leaseMs = this.processingLeaseMs, ownerId = this.processingOwnerId } = {}) {
            return this._withDraftTransaction(async () => {
                const table = this.runtime.DataStore.db.draftRestaurants;
                const raw = await table.get(draftId);
                const states = raw?.photoProcessing && typeof raw.photoProcessing === 'object'
                    ? { ...raw.photoProcessing }
                    : null;
                const current = states?.[sourceId];
                if (!raw || !current?.sourceId) return null;

                const now = Date.now();
                if (this._leaseIsActive(current, now)) return null;

                const token = this._newToken();
                const nextState = {
                    ...current,
                    status: 'processing',
                    processingStartedAt: new Date(now).toISOString(),
                    processingLeaseToken: token,
                    processingLeaseOwner: String(ownerId || this.processingOwnerId),
                    processingLeaseExpiresAt: new Date(now + Math.max(1000, Number(leaseMs) || this.processingLeaseMs)).toISOString(),
                    lastError: null
                };
                states[sourceId] = nextState;
                await table.update(draftId, { photoProcessing: states, lastModified: new Date() });
                return { draftId, sourceId, token, state: nextState };
            });
        }

        async assertLease(lease) {
            return this._withDraftTransaction(() => this._assertLeaseDirect(lease));
        }

        async release(lease) {
            if (!lease) return false;
            return this._withDraftTransaction(async () => {
                const table = this.runtime.DataStore.db.draftRestaurants;
                const raw = await table.get(lease.draftId);
                const states = raw?.photoProcessing && typeof raw.photoProcessing === 'object'
                    ? { ...raw.photoProcessing }
                    : null;
                const current = states?.[lease.sourceId];
                if (!raw || !current || current.processingLeaseToken !== lease.token) return false;
                states[lease.sourceId] = {
                    ...current,
                    processingLeaseToken: null,
                    processingLeaseOwner: null,
                    processingLeaseExpiresAt: null
                };
                await table.update(lease.draftId, { photoProcessing: states, lastModified: new Date() });
                return true;
            });
        }

        install(processor = this.runtime.offlinePhotoProcessor) {
            if (!processor?._updatePhotoProcessing || !processor?.processPhoto || !processor?.materialize) return false;
            if (this._installed || processor.__offlinePhotoLeaseGuardInstalled) {
                this._installed = true;
                return true;
            }

            const guard = this;
            const originalProcessPhoto = processor.processPhoto.bind(processor);
            const originalMaterialize = processor.materialize.bind(processor);
            const originalRunPending = typeof processor._runPending === 'function'
                ? processor._runPending.bind(processor)
                : null;

            processor.__offlinePhotoLeaseGuardInstalled = true;
            processor.__offlinePhotoLeaseOriginalUpdate = processor._updatePhotoProcessing.bind(processor);
            processor.__offlinePhotoLeaseOriginalProcessPhoto = originalProcessPhoto;
            processor.__offlinePhotoLeaseOriginalMaterialize = originalMaterialize;
            if (originalRunPending) processor.__offlinePhotoLeaseOriginalRunPending = originalRunPending;

            processor._updatePhotoProcessing = (draftId, updater) => guard._transactionalUpdate(
                draftId,
                updater,
                processor.__offlinePhotoActiveLease || null
            );

            processor.materialize = async (...args) => guard._withMaterializationTransaction(async () => {
                const active = processor.__offlinePhotoActiveLease || null;
                if (active) await guard._assertLeaseDirect(active);

                // The processor receives a draft snapshot collected before any
                // photo in this reconnect pass is analyzed. Reload inside the
                // same RW transaction so a second photo sees concepts/name
                // materialized by the first instead of overwriting them.
                const draft = args[0];
                let callArgs = args;
                if (draft?.id && guard.runtime.DraftRestaurantManager?.getDraft) {
                    const freshDraft = await guard.runtime.DraftRestaurantManager.getDraft(draft.id).catch(() => null);
                    if (freshDraft) callArgs = [freshDraft, ...args.slice(1)];
                }
                return originalMaterialize(...callArgs);
            });

            processor.processPhoto = async (draft, photo, sourceId, state) => {
                const lease = await guard.claim(draft?.id, sourceId);
                if (!lease) {
                    processor.__offlinePhotoLeaseSkipCount = (processor.__offlinePhotoLeaseSkipCount || 0) + 1;
                    return { status: 'skipped', sourceId };
                }
                const previous = processor.__offlinePhotoActiveLease || null;
                processor.__offlinePhotoActiveLease = lease;
                try {
                    return await originalProcessPhoto(draft, photo, sourceId, state);
                } catch (error) {
                    if (error?.name === 'ProcessingLeaseLostError') {
                        processor.__offlinePhotoLeaseSkipCount = (processor.__offlinePhotoLeaseSkipCount || 0) + 1;
                        guard.log.warn(`Photo lease lost for ${sourceId}; stale worker skipped`);
                        return { status: 'skipped', sourceId, error };
                    }
                    throw error;
                } finally {
                    await guard.release(lease).catch(() => false);
                    processor.__offlinePhotoActiveLease = previous;
                }
            };

            if (originalRunPending) {
                processor._runPending = async (...args) => {
                    const previousSkipCount = processor.__offlinePhotoLeaseSkipCount || 0;
                    processor.__offlinePhotoLeaseSkipCount = 0;
                    try {
                        const summary = await originalRunPending(...args);
                        const leaseSkips = processor.__offlinePhotoLeaseSkipCount || 0;
                        if (summary && leaseSkips > 0) {
                            summary.failed = Math.max(0, Number(summary.failed || 0) - leaseSkips);
                            summary.skipped = Number(summary.skipped || 0) + leaseSkips;
                        }
                        return summary;
                    } finally {
                        processor.__offlinePhotoLeaseSkipCount = previousSkipCount;
                    }
                };
            }

            this._installed = true;
            return true;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Photo lease guard could not attach');
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

    global.OfflinePhotoLeaseGuard = OfflinePhotoLeaseGuard;
    if (global.document && !global.offlinePhotoLeaseGuard) {
        global.offlinePhotoLeaseGuard = new OfflinePhotoLeaseGuard(global).start();
    }
})(window);
