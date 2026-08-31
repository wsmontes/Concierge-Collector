/*
 * Offline Part 2 bootstrap
 *
 * Loads the focused offline-first services in dependency order in the legacy
 * script application. Each module is same-origin and therefore part of the
 * Service Worker build manifest/app shell.
 */
(function bootstrapOfflinePart2(global) {
    'use strict';

    if (global.__offlinePart2BootstrapStarted || typeof document === 'undefined') return;
    global.__offlinePart2BootstrapStarted = true;

    const dependencies = [
        ['SyncSemanticPolicy', 'scripts/services/syncSemanticPolicy.js?v=20260830-1'],
        ['SyncOwnershipFailureGuard', 'scripts/services/syncOwnershipFailureGuard.js?v=20260830-1'],
        ['LocalEntitySearch', 'scripts/services/localEntitySearch.js?v=20260830-1'],
        ['CurationOwnershipPolicy', 'scripts/services/curationOwnershipPolicy.js?v=20260830-1'],
        ['OfflineLinkingModule', 'scripts/modules/offlineLinkingModule.js?v=20260830-1'],
        ['OfflineOwnershipModule', 'scripts/modules/offlineOwnershipModule.js?v=20260830-1'],
        ['OfflineCaptureProcessor', 'scripts/services/offlineCaptureProcessor.js?v=20260830-1'],
        ['OfflinePhotoProcessor', 'scripts/services/offlinePhotoProcessor.js?v=20260830-1'],
        ['OfflinePhotoLeaseGuard', 'scripts/services/offlinePhotoLeaseGuard.js?v=20260831-1'],
        ['OfflinePhotoDurabilityGuard', 'scripts/services/offlinePhotoDurabilityGuard.js?v=20260831-1'],
        ['OfflineSourceIdentityBridge', 'scripts/modules/offlineSourceIdentityBridge.js?v=20260830-1'],
        ['OfflineKnownLinkageGuard', 'scripts/modules/offlineKnownLinkageGuard.js?v=20260830-1'],
        ['OfflineExplicitDiscardGuard', 'scripts/modules/offlineExplicitDiscardGuard.js?v=20260830-1'],
        ['OfflineCuratorIdentityGuard', 'scripts/modules/offlineCuratorIdentityGuard.js?v=20260830-1'],
        // Loaded last on purpose. It waits for the save compatibility wrappers
        // above to attach, then becomes the outermost serialized save boundary.
        ['OfflineSaveCoordinator', 'scripts/services/offlineSaveCoordinator.js?v=20260831-1']
    ];

    function loadScript(globalName, src) {
        if (global[globalName]) return Promise.resolve();
        const existing = [...document.scripts].find((script) => script.src?.includes(src.split('?')[0]));
        if (existing) {
            return new Promise((resolve) => {
                if (global[globalName]) return resolve();
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 5000);
            });
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.dataset.offlinePart2 = globalName;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', () => {
                console.warn(`[OfflinePart2] Failed to load ${src}`);
                resolve();
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    (async () => {
        for (const [globalName, src] of dependencies) {
            await loadScript(globalName, src);
        }
        global.dispatchEvent?.(new CustomEvent('concierge:offline-part2-ready'));
    })();
})(window);
