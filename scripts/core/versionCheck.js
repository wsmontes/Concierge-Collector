/**
 * Version Check Module
 * Automatically checks for new versions and forces reload when needed
 * Professional approach: no manual cache clearing required
 */

const VersionCheck = (() => {
    const CURRENT_VERSION = window.APP_VERSION || '9.0.0';
    const VERSION_KEY = 'app_version';
    const CHECK_INTERVAL = 30000; // Check every 30 seconds

    /**
     * Initialize version checking
     */
    function initialize() {
        // Check stored version
        const storedVersion = localStorage.getItem(VERSION_KEY);
        
        if (storedVersion && storedVersion !== CURRENT_VERSION) {
            console.warn(`🔄 Version mismatch: ${storedVersion} → ${CURRENT_VERSION}`);
            console.warn('🔄 Forcing reload with cache clear...');
            
            // Clear version storage
            localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
            
            // Force hard reload (bypasses cache)
            window.location.reload(true);
            return;
        }
        
        // Store current version
        localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
        
        // Start periodic version check
        startPeriodicCheck();
    }

    /**
     * Start periodic version checking
     */
    function startPeriodicCheck() {
        setInterval(async () => {
            try {
                // Fetch index.html with cache-busting
                const response = await fetch(`/?v=${Date.now()}`, {
                    method: 'GET',
                    cache: 'no-cache',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });
                
                const html = await response.text();
                
                // Extract version from HTML
                const versionMatch = html.match(/window\.APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
                if (versionMatch && versionMatch[1]) {
                    const remoteVersion = versionMatch[1];
                    
                    if (remoteVersion !== CURRENT_VERSION) {
                        console.warn(`🔄 New version detected: ${CURRENT_VERSION} → ${remoteVersion}`);
                        console.warn('🔄 Reloading application...');
                        
                        // Update stored version
                        localStorage.setItem(VERSION_KEY, remoteVersion);
                        
                        // Force hard reload
                        window.location.reload(true);
                    }
                }
            } catch (error) {
                // Silent fail - don't interrupt user experience
                console.debug('Version check failed:', error.message);
            }
        }, CHECK_INTERVAL);
    }

    return {
        initialize
    };
})();

// Auto-initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VersionCheck.initialize());
} else {
    VersionCheck.initialize();
}
