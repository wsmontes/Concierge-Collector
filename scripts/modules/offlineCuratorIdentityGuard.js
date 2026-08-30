/*
 * OfflineCuratorIdentityGuard
 *
 * Legacy additional-review formatting reads `uiManager.currentCurator`, while
 * OAuth-only sessions use CuratorProfile/AuthService. Expose the authenticated
 * identity only for the duration of that formatting call so the aggregate
 * transcript never says "Unknown Curator" when provenance knows the author.
 */
(function exposeOfflineCuratorIdentityGuard(global) {
    'use strict';

    class OfflineCuratorIdentityGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineCuratorIdentityGuard') || console;
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
                this.log.warn('Curator identity guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        resolvedCurator() {
            const profile = this.runtime.CuratorProfile?.getCurrentCurator?.() || null;
            const user = this.runtime.AuthService?.getCurrentUser?.() || null;
            const id = profile?.curator_id || profile?.id || user?.email || null;
            if (!id) return null;
            return {
                id,
                curator_id: id,
                email: profile?.email || user?.email || id,
                name: profile?.name || user?.name || id
            };
        }

        install() {
            const uiManager = this.runtime.uiManager;
            const conceptModule = uiManager?.conceptModule;
            if (!conceptModule?.handleAdditionalRecordingComplete) return false;
            if (this._installed || conceptModule.__offlineCuratorIdentityGuardInstalled) {
                this._installed = true;
                return true;
            }

            const original = conceptModule.handleAdditionalRecordingComplete.bind(conceptModule);
            const guard = this;
            conceptModule.__offlineCuratorIdentityGuardInstalled = true;
            conceptModule.__offlineCuratorIdentityOriginalAdditionalComplete = original;

            conceptModule.handleAdditionalRecordingComplete = (...args) => {
                const previous = uiManager.currentCurator || null;
                if (!previous) {
                    const resolved = guard.resolvedCurator();
                    if (resolved) uiManager.currentCurator = resolved;
                }
                try {
                    return original(...args);
                } finally {
                    if (!previous) uiManager.currentCurator = previous;
                }
            };

            this._installed = true;
            return true;
        }
    }

    global.OfflineCuratorIdentityGuard = OfflineCuratorIdentityGuard;
    if (global.document && !global.offlineCuratorIdentityGuard) {
        global.offlineCuratorIdentityGuard = new OfflineCuratorIdentityGuard(global).start();
    }
})(window);
