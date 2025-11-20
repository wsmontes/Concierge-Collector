/**
 * File: auth.js
 * Purpose: Google OAuth 2.0 authentication client
 * Dependencies: config.js
 * 
 * Clean, robust OAuth implementation following best practices:
 * - Token extraction from URL after OAuth redirect
 * - Secure token storage in localStorage
 * - Automatic token verification with backend
 * - Clear, detailed logging for debugging
 * 
 * Authentication Flow:
 * 1. User clicks "Sign in with Google"
 * 2. Redirect to backend /auth/google
 * 3. Backend redirects to Google OAuth
 * 4. Google redirects back to backend /auth/callback
 * 5. Backend validates and redirects to frontend with tokens in URL
 * 6. Frontend extracts tokens, stores in localStorage, cleans URL
 * 7. Frontend verifies token with backend
 * 8. App grants access
 */

const AuthService = (function() {
    'use strict';

    /**
     * Module dependencies
     */
    const dependencies = {
        required: ['AppConfig'],
        optional: []
    };

    /**
     * Private state
     */
    let _initialized = false;
    let _currentUser = null;
    let _processingCallback = false; // Flag to prevent reload interference

    /**
     * OAuth Endpoints
     */
    const ENDPOINTS = {
        login: '/auth/google',
        verify: '/auth/verify',
        logout: '/auth/logout'
    };

    /**
     * Storage Keys (from AppConfig)
     */
    function getStorageKeys() {
        return AppConfig.storage.keys;
    }

    /**
     * Get the OAuth access token from localStorage
     * @returns {string|null} Access token or null
     */
    function getToken() {
        const keys = getStorageKeys();
        return localStorage.getItem(keys.oauthToken);
    }

    /**
     * Get the refresh token from localStorage
     * @returns {string|null} Refresh token or null
     */
    function getRefreshToken() {
        const keys = getStorageKeys();
        return localStorage.getItem(keys.oauthRefreshToken);
    }

    /**
     * Get token expiry timestamp from localStorage
     * @returns {number|null} Expiry timestamp or null
     */
    function getTokenExpiry() {
        const keys = getStorageKeys();
        const expiry = localStorage.getItem(keys.oauthExpiry);
        return expiry ? parseInt(expiry, 10) : null;
    }

    /**
     * Check if the current token is expired
     * @returns {boolean} True if token is expired or missing
     */
    function isTokenExpired() {
        const token = getToken();
        if (!token) {
            console.log('[AuthService] No token found');
            return true;
        }

        const expiry = getTokenExpiry();
        if (!expiry) {
            console.log('[AuthService] No expiry found');
            return true;
        }

        const now = Date.now();
        const isExpired = now >= expiry;
        
        if (isExpired) {
            console.log('[AuthService] Token expired');
            console.log(`[AuthService]   now: ${new Date(now).toISOString()}`);
            console.log(`[AuthService]   expiry: ${new Date(expiry).toISOString()}`);
        }
        
        return isExpired;
    }

    /**
     * Store authentication tokens in localStorage
     * @param {Object} tokenData Token data from backend
     * @param {string} tokenData.access_token OAuth access token
     * @param {string} [tokenData.refresh_token] OAuth refresh token
     * @param {number} [tokenData.expires_in] Token lifetime in seconds
     */
    function storeTokens(tokenData) {
        if (!tokenData || !tokenData.access_token) {
            throw new Error('Invalid token data: missing access_token');
        }

        const keys = getStorageKeys();

        // Store access token
        localStorage.setItem(keys.oauthToken, tokenData.access_token);
        console.log('[AuthService] ✓ Access token stored');

        // Store refresh token if present
        if (tokenData.refresh_token) {
            localStorage.setItem(keys.oauthRefreshToken, tokenData.refresh_token);
            console.log('[AuthService] ✓ Refresh token stored');
        }

        // Calculate and store expiry timestamp
        const expiresIn = tokenData.expires_in || 3600; // Default 1 hour
        const expiryTimestamp = Date.now() + (expiresIn * 1000);
        localStorage.setItem(keys.oauthExpiry, expiryTimestamp.toString());
        
        const expiryDate = new Date(expiryTimestamp).toLocaleString();
        console.log(`[AuthService] ✓ Token expires at: ${expiryDate}`);
    }

    /**
     * Clear all authentication data from localStorage
     */
    function clearTokens() {
        const keys = getStorageKeys();
        localStorage.removeItem(keys.oauthToken);
        localStorage.removeItem(keys.oauthRefreshToken);
        localStorage.removeItem(keys.oauthExpiry);
        _currentUser = null;
        console.log('[AuthService] Tokens cleared');
    }

    /**
     * Extract tokens from URL query parameters
     * Called after OAuth redirect from backend
     * @returns {Object|null} Token data or null if not present
     */
    function extractTokensFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        
        const accessToken = urlParams.get('access_token');
        const refreshToken = urlParams.get('refresh_token');
        const expiresIn = urlParams.get('expires_in');
        const userEmail = urlParams.get('user_email');
        const userName = urlParams.get('user_name');
        const authError = urlParams.get('auth_error');

        console.log('[AuthService] Checking URL for tokens...');
        console.log(`[AuthService]   access_token: ${accessToken ? 'present' : 'missing'}`);
        console.log(`[AuthService]   refresh_token: ${refreshToken ? 'present' : 'missing'}`);
        console.log(`[AuthService]   expires_in: ${expiresIn || 'missing'}`);
        console.log(`[AuthService]   user_email: ${userEmail || 'missing'}`);
        console.log(`[AuthService]   auth_error: ${authError || 'none'}`);

        // If we have tokens in URL, mark callback as in progress
        if (accessToken) {
            sessionStorage.setItem('oauth_callback_in_progress', 'true');
            console.log('[AuthService] OAuth callback in progress - protecting from reload');
        }

        // Check for auth error
        if (authError) {
            console.error(`[AuthService] Authentication error: ${authError}`);
            
            // Special handling for "not_authorized" error
            if (authError === 'not_authorized') {
                sessionStorage.removeItem('oauth_callback_in_progress');
                return { 
                    error: 'not_authorized',
                    message: `Your account (${userEmail || 'unknown'}) is not authorized. Please contact the administrator.`
                };
            }
            
            sessionStorage.removeItem('oauth_callback_in_progress');
            return { error: authError };
        }

        // Check if tokens are present
        if (!accessToken) {
            console.log('[AuthService] No tokens in URL');
            return null;
        }

        return {
            access_token: accessToken,
            refresh_token: refreshToken || '',
            expires_in: parseInt(expiresIn || '3600'),
            user_email: userEmail,
            user_name: userName
        };
    }

    /**
     * Clean URL by removing query parameters
     */
    function cleanURL() {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        console.log('[AuthService] URL cleaned');
    }

    /**
     * Initiate Google OAuth login flow
     */
    async function login() {
        try {
            console.log('[AuthService] Initiating Google OAuth login...');

            const baseUrl = AppConfig.api.backend.baseUrl;
            const authUrl = `${baseUrl}${ENDPOINTS.login}`;

            console.log(`[AuthService] Redirecting to: ${authUrl}`);
            
            // Mark OAuth as starting to prevent Live Server interference
            sessionStorage.setItem('oauth_redirect_in_progress', 'true');
            console.log('[AuthService] 🔒 OAuth redirect protection enabled');

            // Small delay to ensure sessionStorage is written
            await new Promise(resolve => setTimeout(resolve, 100));

            // Redirect to backend OAuth endpoint
            // Backend will redirect to Google OAuth consent screen
            window.location.href = authUrl;

        } catch (error) {
            console.error('[AuthService] Login failed:', error);
            sessionStorage.removeItem('oauth_redirect_in_progress');
            throw error;
        }
    }

    /**
     * Verify current token with backend
     * @returns {Promise<Object|null>} User data or null if invalid
     */
    async function verifyToken() {
        const token = getToken();
        if (!token) {
            console.log('[AuthService] No token to verify');
            return null;
        }

        try {
            console.log('[AuthService] Verifying token with backend...');
            
            const baseUrl = AppConfig.api.backend.baseUrl;
            const verifyUrl = `${baseUrl}${ENDPOINTS.verify}`;

            const response = await fetch(verifyUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                console.warn(`[AuthService] Token verification failed: ${response.status} ${response.statusText}`);
                
                if (response.status === 403) {
                    const errorData = await response.json();
                    console.warn('[AuthService] User not authorized:', errorData.detail);
                } else if (response.status === 401) {
                    console.warn('[AuthService] Token invalid or expired');
                }
                
                clearTokens();
                return null;
            }

            const userData = await response.json();
            _currentUser = userData;
            
            console.log('[AuthService] ✓ Token verified');
            console.log(`[AuthService] ✓ User: ${userData.email}`);
            console.log(`[AuthService] ✓ Authorized: ${userData.authorized}`);
            
            return userData;

        } catch (error) {
            console.error('[AuthService] Token verification error:', error);
            clearTokens();
            return null;
        }
    }

    /**
     * Logout user and clear all auth data
     */
    async function logout() {
        try {
            const token = getToken();
            if (token) {
                // Notify backend to revoke token
                const baseUrl = AppConfig.api.backend.baseUrl;
                const logoutUrl = `${baseUrl}${ENDPOINTS.logout}`;

                await fetch(logoutUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (error) {
            console.error('[AuthService] Logout request failed:', error);
        } finally {
            // Clear local data regardless of backend response
            clearTokens();
            console.log('[AuthService] User logged out');
        }
    }

    /**
     * Check if user is currently authenticated
     * @returns {boolean} True if authenticated with valid token
     */
    function isAuthenticated() {
        const hasToken = getToken() !== null;
        const notExpired = !isTokenExpired();
        const result = hasToken && notExpired;
        
        console.log(`[AuthService] isAuthenticated: ${result} (hasToken: ${hasToken}, notExpired: ${notExpired})`);
        
        return result;
    }

    /**
     * Get current user data
     * @returns {Object|null} User object or null if not authenticated
     */
    function getCurrentUser() {
        return _currentUser;
    }

    /**
     * Initialize the auth service
     * 
     * Checks for:
     * 1. Tokens in URL (OAuth callback)
     * 2. Existing valid tokens in localStorage
     * 
     * @returns {Promise<Object|null>} Current user or null
     */
    async function initialize() {
        if (_initialized) {
            console.warn('[AuthService] Already initialized');
            return _currentUser;
        }

        console.log('[AuthService] ========================================');
        console.log('[AuthService] Initializing...');
        console.log('[AuthService] ========================================');
        console.log(`[AuthService] URL: ${window.location.href}`);

        // Step 1: Check for tokens in URL (OAuth callback)
        const urlTokens = extractTokensFromURL();
        
        if (urlTokens) {
            if (urlTokens.error) {
                console.error(`[AuthService] Auth error in URL: ${urlTokens.error}`);
                if (urlTokens.message) {
                    console.error(`[AuthService] ${urlTokens.message}`);
                }
                cleanURL();
                sessionStorage.removeItem('oauth_callback_in_progress');
                _initialized = true;
                
                // Store error for AccessControl to display
                sessionStorage.setItem('auth_error', urlTokens.message || urlTokens.error);
                
                return null;
            }
            
            console.log('[AuthService] ✓ Tokens found in URL, storing...');
            storeTokens(urlTokens);
            cleanURL();
            sessionStorage.removeItem('oauth_callback_in_progress');
            console.log('[AuthService] ✓ OAuth callback complete');
        }

        // Step 2: Check for existing token in localStorage
        console.log('[AuthService] Checking localStorage...');
        const hasToken = getToken() !== null;
        console.log(`[AuthService]   Has token: ${hasToken}`);
        
        if (hasToken) {
            console.log(`[AuthService]   Token expired: ${isTokenExpired()}`);
        }

        if (isAuthenticated()) {
            console.log('[AuthService] Valid token found, verifying...');
            
            // Verify token with backend
            const user = await verifyToken();

            if (user) {
                console.log('[AuthService] ========================================');
                console.log('[AuthService] ✓ Initialization complete');
                console.log(`[AuthService] ✓ Logged in as: ${user.email}`);
                console.log('[AuthService] ========================================');
            } else {
                console.log('[AuthService] ========================================');
                console.log('[AuthService] ✗ Token verification failed');
                console.log('[AuthService] ========================================');
            }
        } else {
            console.log('[AuthService] ========================================');
            console.log('[AuthService] No valid token found');
            console.log('[AuthService] ========================================');
        }

        _initialized = true;
        return _currentUser;
    }

    /**
     * Public API
     */
    return {
        dependencies,
        initialize,
        login,
        logout,
        verifyToken,
        isAuthenticated,
        isTokenExpired,
        getCurrentUser,
        getToken,
        clearTokens
    };
})();

// Register with ModuleWrapper or attach to window
if (typeof ModuleWrapper !== 'undefined' && typeof ModuleWrapper.register === 'function') {
    ModuleWrapper.register('AuthService', AuthService);
    console.log('[AuthService] Registered with ModuleWrapper');
} else {
    window.AuthService = AuthService;
    console.log('[AuthService] Attached to window (ModuleWrapper not available)');
}
