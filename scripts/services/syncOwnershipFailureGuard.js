/*
 * SyncOwnershipFailureGuard
 *
 * Ownership rejection on a Curation write is permanent, but HTTP 403 alone is
 * not ownership semantics. Only an explicit machine-readable ownership code
 * may quarantine the local Curation as `ownership_forbidden`; generic role or
 * authorization failures remain ordinary sync failures.
 */
(function exposeSyncOwnershipFailureGuard(global) {
    'use strict';

    const OWNERSHIP_CODES = new Set([
        'curation_owner_mismatch',
        'curation_ownership_forbidden'
    ]);

    class SyncOwnershipFailureGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('SyncOwnershipFailureGuard') || console;
            this.failures = new Map();
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
                this.log.warn('Sync ownership failure guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        errorCode(value) {
            if (!value) return null;
            const candidates = [
                value?.code,
                value?.errorCode,
                value?.detail?.code,
                value?.error?.code,
                value?.body?.code,
                value?.response?.data?.code
            ];
            const code = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
            return code ? code.trim().toLowerCase() : null;
        }

        isOwnershipFailure(value) {
            const code = this.errorCode(value);
            return Boolean(code && OWNERSHIP_CODES.has(code));
        }

        remember(curationId, error) {
            if (!curationId) return;
            this.failures.set(String(curationId), {
                curationId: String(curationId),
                code: this.errorCode(error),
                message: String(error?.message || error?.error || error?.detail?.message || error || 'Forbidden Curation write'),
                at: new Date().toISOString()
            });
        }

        consume(curationId) {
            const key = String(curationId || '');
            if (!key || !this.failures.has(key)) return null;
            const failure = this.failures.get(key);
            this.failures.delete(key);
            return failure;
        }

        installErrorCodeBridge(api) {
            if (!api?.handleErrorResponse || api.__syncOwnershipErrorCodeBridgeInstalled) return Boolean(api?.__syncOwnershipErrorCodeBridgeInstalled);
            const originalHandle = api.handleErrorResponse.bind(api);
            api.__syncOwnershipErrorCodeBridgeInstalled = true;
            api.__syncOwnershipOriginalHandleErrorResponse = originalHandle;

            api.handleErrorResponse = async (response, ...args) => {
                let code = null;
                try {
                    const body = response?.clone ? await response.clone().json() : null;
                    code = this.errorCode(body?.detail || body);
                } catch (_) {}

                try {
                    return await originalHandle(response, ...args);
                } catch (error) {
                    if (code) error.code = code;
                    throw error;
                }
            };
            return true;
        }

        installApiGuards() {
            const api = this.runtime.ApiService;
            if (!api?.updateCuration || !api?.bulkUpsertCurations) return false;
            this.installErrorCodeBridge(api);
            if (api.__syncOwnershipFailureGuardInstalled) return true;

            const guard = this;
            const originalUpdate = api.updateCuration.bind(api);
            const originalBulk = api.bulkUpsertCurations.bind(api);
            api.__syncOwnershipFailureGuardInstalled = true;
            api.__syncOwnershipFailureOriginalUpdateCuration = originalUpdate;
            api.__syncOwnershipFailureOriginalBulkUpsertCurations = originalBulk;

            api.updateCuration = async (curationId, ...args) => {
                try {
                    return await originalUpdate(curationId, ...args);
                } catch (error) {
                    if (guard.isOwnershipFailure(error)) guard.remember(curationId, error);
                    throw error;
                }
            };

            api.bulkUpsertCurations = async (curations, ...args) => {
                const result = await originalBulk(curations, ...args);
                for (const error of result?.errors || []) {
                    if (!guard.isOwnershipFailure(error)) continue;
                    const curation = Array.isArray(curations) ? curations[error.index] : null;
                    if (curation?.curation_id) guard.remember(curation.curation_id, error);
                }
                return result;
            };
            return true;
        }

        async findLocalCuration(curationId) {
            const table = this.runtime.DataStore?.db?.curations;
            if (!table || !curationId) return null;
            try {
                return await table.where('curation_id').equals(curationId).first();
            } catch (_) {
                try {
                    const rows = await table.toArray();
                    return rows.find((row) => String(row?.curation_id || '') === String(curationId)) || null;
                } catch (_) {
                    return null;
                }
            }
        }

        async markBlocked(manager, curationOrId, failure = null) {
            const curationId = typeof curationOrId === 'string'
                ? curationOrId
                : curationOrId?.curation_id;
            const local = typeof curationOrId === 'object' && curationOrId?.id != null
                ? curationOrId
                : await this.findLocalCuration(curationId);
            if (!local?.id || !curationId) return false;

            await this.runtime.DataStore.db.curations.update(local.id, {
                sync: {
                    ...(local.sync || {}),
                    status: 'conflict',
                    error: 'ownership_forbidden',
                    lastAttempt: new Date().toISOString(),
                    errorDetail: failure?.message || null
                }
            });

            if (typeof manager?._clearCurationQueueRows === 'function') {
                await manager._clearCurationQueueRows(curationId);
            } else {
                try {
                    await this.runtime.DataStore.db.syncQueue
                        .where('entity_id').equals(curationId).delete();
                } catch (_) {}
            }

            manager?.emitSyncEvent?.('sync-conflict', {
                type: 'curation',
                id: curationId,
                name: local.restaurant_name || local.name || curationId,
                reason: 'ownership_forbidden'
            });
            this.runtime.uiUtils?.showNotification?.(
                'This Curation belongs to another curator. Your local work was preserved as a conflict instead of being retried.',
                'error'
            );
            return true;
        }

        async flushRemembered(manager) {
            const entries = [...this.failures.entries()];
            for (const [curationId, failure] of entries) {
                const local = await this.findLocalCuration(curationId);
                if (!local) continue;
                await this.markBlocked(manager, local, failure);
                this.failures.delete(curationId);
            }
        }

        installSyncGuards() {
            const proto = this.runtime.SyncManagerV3?.prototype;
            if (!proto?.pushExistingCuration || !proto?.pushCurations) return false;
            if (proto.__syncOwnershipFailureGuardInstalled) return true;

            const guard = this;
            const originalExisting = proto.pushExistingCuration;
            const originalPushCurations = proto.pushCurations;
            proto.__syncOwnershipFailureGuardInstalled = true;
            proto.__syncOwnershipFailureOriginalPushExistingCuration = originalExisting;
            proto.__syncOwnershipFailureOriginalPushCurations = originalPushCurations;

            proto.pushExistingCuration = async function (curation, ...args) {
                const result = await originalExisting.call(this, curation, ...args);
                const failure = guard.consume(curation?.curation_id);
                if (!failure) return result;
                await guard.markBlocked(this, curation, failure);
                return 'conflict';
            };

            proto.pushCurations = async function (...args) {
                const result = await originalPushCurations.apply(this, args);
                // Bulk upsert reports per-item errors instead of throwing.
                // Convert only remembered ownership-domain failures after the
                // normal bulk loop; generic 403s remain normal sync failures.
                await guard.flushRemembered(this);
                return result;
            };
            return true;
        }

        install() {
            const apiReady = this.installApiGuards();
            const syncReady = this.installSyncGuards();
            this._installed = apiReady && syncReady;
            return this._installed;
        }
    }

    global.SyncOwnershipFailureGuard = SyncOwnershipFailureGuard;
    if (global.document && !global.syncOwnershipFailureGuard) {
        global.syncOwnershipFailureGuard = new SyncOwnershipFailureGuard(global).start();
    }
})(window);
