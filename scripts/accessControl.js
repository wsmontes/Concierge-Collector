/**
 * Access Control Module
 * 
 * Purpose: Gate application access via Google OAuth authentication
 * 
 * Clean, simple flow:
 * 1. Check if user is authenticated (via AuthService)
 * 2. If yes: initialize app
 * 3. If no: show Google sign-in overlay
 * 
 * Dependencies: auth.js, config.js
 */

const AccessControl = (function() {
    'use strict';

    /**
     * Track if app has been initialized to prevent double-init on hot-reload
     */
    let appInitialized = false;

    /**
     * Detect Live Server (VS Code extension) for dev mode
     */
    const isLiveServer = window.location.port === '5500' || window.location.port === '5501';

    if (isLiveServer) {
        console.log('[AccessControl] 🔴 Live Server detected (dev mode)');
        
        // Reset on hot-reload
        window.addEventListener('beforeunload', () => {
            console.log('[AccessControl] 🔄 Resetting on hot-reload');
            appInitialized = false;
        });
    }

    /**
     * Show Google Sign-In overlay with debug info
     */
    function showLoginPrompt(errorMessage = null) {
        console.log('[AccessControl] Showing login prompt');
        
        // Check for error in sessionStorage (from OAuth callback)
        if (!errorMessage) {
            errorMessage = sessionStorage.getItem('auth_error');
            if (errorMessage) {
                sessionStorage.removeItem('auth_error');
            }
        }
        
        if (errorMessage) {
            console.log(`[AccessControl] Error message: ${errorMessage}`);
        }

        // Remove existing overlay if any
        const existing = document.getElementById('access-control-overlay');
        if (existing) {
            existing.remove();
        }

        // Get debug info
        const hasToken = !!localStorage.getItem('oauth_access_token');
        const tokenExpiry = localStorage.getItem('oauth_token_expiry');
        const expiryDate = tokenExpiry ? new Date(parseInt(tokenExpiry)).toLocaleString() : 'N/A';

        const overlay = document.createElement('div');
        overlay.id = 'access-control-overlay';
        overlay.innerHTML = `
            <div class="access-control-container">
                <div class="access-control-card">
                    <img src="images/Lotier_Logo.webp" alt="Lotier Logo" class="access-control-logo">
                    <h1>Collector</h1>
                    <p>Sign in with your authorized Google account</p>
                    
                    <button id="google-signin-button" class="google-signin-btn">
                        <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                            <path fill="none" d="M0 0h48v48H0z"></path>
                        </svg>
                        Sign in with Google
                    </button>
                    
                    ${errorMessage ? `<div class="access-error">${errorMessage}</div>` : ''}
                    
                    <p class="access-note">Only authorized users can access this application.</p>
                    
                    <!-- Debug Info -->
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
                        <details style="text-align: left; font-size: 11px; color: #666;">
                            <summary style="cursor: pointer; font-weight: 600; margin-bottom: 8px;">🔍 Debug Info</summary>
                            <div style="font-family: monospace; font-size: 10px; line-height: 1.6;">
                                <strong>Environment:</strong><br>
                                Origin: ${window.location.origin}<br>
                                Port: ${window.location.port}<br>
                                <br>
                                <strong>Token Status:</strong><br>
                                Has Token: ${hasToken ? '✓ Yes' : '✗ No'}<br>
                                ${hasToken ? `Expires: ${expiryDate}<br>` : ''}
                                <br>
                                <strong>Last Error:</strong><br>
                                ${errorMessage || 'None'}
                            </div>
                        </details>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        // Attach event listener to sign-in button
        const signinButton = document.getElementById('google-signin-button');
        signinButton.addEventListener('click', async () => {
            try {
                console.log('[AccessControl] Sign-in button clicked');
                signinButton.disabled = true;
                signinButton.textContent = 'Redirecting...';
                
                // Initiate OAuth flow via AuthService
                await AuthService.login();
                
            } catch (error) {
                console.error('[AccessControl] Login failed:', error);
                signinButton.disabled = false;
                signinButton.innerHTML = `
                    <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.30-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                    Sign in with Google
                `;
                
                showLoginPrompt(error.message || 'Login failed. Please try again.');
            }
        });
    }

    /**
     * Initialize the application (called after successful authentication)
     */
    function initializeApp() {
        console.log('[AccessControl] ========================================');
        console.log('[AccessControl] initializeApp() called');
        
        // Prevent double initialization on hot-reload
        if (appInitialized) {
            console.warn('[AccessControl] ⚠️  App already initialized, skipping');
            console.log('[AccessControl] ========================================');
            return;
        }
        
        appInitialized = true;
        console.log('[AccessControl] ✓ Setting appInitialized = true');
        
        // Wait for window.startApplication to be defined by main.js
        const checkAndStart = () => {
            if (typeof window.startApplication === 'function') {
                console.log('[AccessControl] ✓ window.startApplication found');
                console.log('[AccessControl] ✓ Starting application...');
                console.log('[AccessControl] ========================================');
                window.startApplication();
            } else {
                console.log('[AccessControl] ⏳ Waiting for main.js...');
                setTimeout(checkAndStart, 50);
            }
        };
        
        checkAndStart();
    }

    /**
     * Check access and show login prompt if needed
     * Main entry point for access control
     */
    async function checkAccess() {
        console.log('[AccessControl] ========================================');
        console.log('[AccessControl] checkAccess() called');
        console.log('[AccessControl] ========================================');
        
        // Wait for AuthService to be available
        if (typeof AuthService === 'undefined') {
            console.log('[AccessControl] ⏳ Waiting for AuthService...');
            setTimeout(checkAccess, 50);
            return;
        }

        try {
            console.log('[AccessControl] AuthService available');
            
            // Initialize AuthService (checks tokens, verifies with backend)
            const user = await AuthService.initialize();

            console.log('[AccessControl] ========================================');
            console.log(`[AccessControl] AuthService.initialize() returned: ${user ? 'User object' : 'null'}`);
            
            if (user) {
                console.log(`[AccessControl] ✓ User authenticated: ${user.email}`);
                console.log(`[AccessControl] ✓ User authorized: ${user.authorized}`);
                console.log('[AccessControl] ========================================');
                initializeApp();
            } else {
                console.log('[AccessControl] ✗ No valid authentication');
                console.log('[AccessControl] ========================================');
                showLoginPrompt();
            }
        } catch (error) {
            console.error('[AccessControl] ========================================');
            console.error('[AccessControl] ✗ Error during access check:', error);
            console.error('[AccessControl] ========================================');
            showLoginPrompt(`Error: ${error.message}`);
        }
    }

    /**
     * Logout and reset access
     */
    async function logout() {
        console.log('[AccessControl] Logout requested');
        try {
            if (typeof AuthService !== 'undefined') {
                await AuthService.logout();
            }
            console.log('[AccessControl] Reloading page...');
            location.reload();
        } catch (error) {
            console.error('[AccessControl] Logout error:', error);
            location.reload();
        }
    }

    /**
     * Check if user has access (quick check without async)
     * @returns {boolean} True if authenticated
     */
    function hasAccess() {
        if (typeof AuthService === 'undefined') {
            return false;
        }
        return AuthService.isAuthenticated();
    }

    // Public API
    return {
        checkAccess,
        logout,
        hasAccess
    };
})();

// Auto-check access when script loads
console.log('[AccessControl] ========================================');
console.log('[AccessControl] Script loaded');
console.log('[AccessControl] ========================================');

if (document.readyState === 'loading') {
    console.log('[AccessControl] DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[AccessControl] DOMContentLoaded fired');
        AccessControl.checkAccess();
    });
} else {
    console.log('[AccessControl] DOM already loaded');
    AccessControl.checkAccess();
}
