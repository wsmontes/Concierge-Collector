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
            console.log('[AuthService] isTokenExpired: No token found');
            return true;
        }

        const expiry = getTokenExpiry();
        if (!expiry) {
            console.log('[AuthService] isTokenExpired: No expiry found');
            return true;
        }

        const now = Date.now();
        const isExpired = now >= expiry;
        
        if (isExpired) {
            console.log('[AuthService] isTokenExpired: Token expired');
            console.log(`[AuthService]   now: ${new Date(now).toISOString()}`);
            console.log(`[AuthService]   expiry: ${new Date(expiry).toISOString()}`);
        } else {
            console.log('[AuthService] isTokenExpired: Token still valid');
            const remainingMinutes = Math.round((expiry - now) / 60000);
            console.log(`[AuthService]   Remaining time: ${remainingMinutes} minutes`);
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
        console.log('[AuthService] storeTokens() called with:', {
            hasAccessToken: !!tokenData?.access_token,
            hasRefreshToken: !!tokenData?.refresh_token,
            expiresIn: tokenData?.expires_in
        });
        
        if (!tokenData || !tokenData.access_token) {
            // NUNCA logar o tokenData em si (carrega access/refresh token) —
            // console.error pode ser coletado por ferramentas de monitoramento
            // (auditoria ago/2026: removia o conteúdo da credencial)
            console.error('[AuthService] ✗ Invalid token data:', {
                hasAccessToken: !!tokenData?.access_token,
                type: typeof tokenData
            });
            throw new Error('Invalid token data: missing access_token');
        }

        const keys = getStorageKeys();
        console.log('[AuthService] Using storage keys:', keys);

        // Store access token
        localStorage.setItem(keys.oauthToken, tokenData.access_token);
        console.log(`[AuthService] ✓ Access token stored to key: ${keys.oauthToken}`);

        // Store refresh token if present
        if (tokenData.refresh_token) {
            localStorage.setItem(keys.oauthRefreshToken, tokenData.refresh_token);
            console.log(`[AuthService] ✓ Refresh token stored to key: ${keys.oauthRefreshToken}`);
        } else {
            console.warn('[AuthService] ⚠️ No refresh token in tokenData');
        }

        // Calculate and store expiry timestamp
        const expiresIn = tokenData.expires_in || 3600; // Default 1 hour
        const expiryTimestamp = Date.now() + (expiresIn * 1000);
        localStorage.setItem(keys.oauthExpiry, expiryTimestamp.toString());
        
        const expiryDate = new Date(expiryTimestamp).toLocaleString();
        console.log(`[AuthService] ✓ Token expires at: ${expiryDate}`);
        
        // Verify storage worked
        console.log('[AuthService] Verification - localStorage now contains:', {
            oauthToken: localStorage.getItem(keys.oauthToken) ? 'present' : 'MISSING',
            oauthRefreshToken: localStorage.getItem(keys.oauthRefreshToken) ? 'present' : 'MISSING',
            oauthExpiry: localStorage.getItem(keys.oauthExpiry)
        });
    }

    /**
     * Clear all authentication data from localStorage
     */
    function clearTokens() {
        const keys = getStorageKeys();
        localStorage.removeItem(keys.oauthToken);
        localStorage.removeItem(keys.oauthRefreshToken);
        localStorage.removeItem(keys.oauthExpiry);
        if (keys.oauthUser) localStorage.removeItem(keys.oauthUser);
        _currentUser = null;
        console.log('[AuthService] Tokens cleared');
    }

    /**
     * Persiste o perfil do usuário para uso OFFLINE — sem isso, um reload
     * sem conexão derruba a identidade (offline-first quebra em campo).
     */
    function saveUserProfile(user) {
        if (!user) return;
        const keys = getStorageKeys();
        if (keys.oauthUser) {
            localStorage.setItem(keys.oauthUser, JSON.stringify(user));
        }
        _currentUser = user;
    }

    /**
     * Recupera o perfil persistido (sobrevive a reload sem rede).
     */
    function getStoredUserProfile() {
        const keys = getStorageKeys();
        if (!keys.oauthUser) return null;
        try {
            return JSON.parse(localStorage.getItem(keys.oauthUser));
        } catch (e) {
            return null;
        }
    }

    /**
     * Extract tokens from URL query parameters
     * Called after OAuth redirect from backend
     * @returns {Object|null} Token data or null if not present
     */
    function extractTokensFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        // iOS Safari descarta Set-Cookie de redirect cross-site (Google →
        // API): o callback same-site também entrega os tokens no FRAGMENT
        // (?session=1#token=...). Fragment não vaza via Referer/logs.
        const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));

        const accessToken = urlParams.get('token') || urlParams.get('access_token')
            || hashParams.get('token') || hashParams.get('access_token');
        const refreshToken = urlParams.get('refresh_token') || hashParams.get('refresh_token');
        const expiresIn = urlParams.get('expires_in') || hashParams.get('expires_in');
        const userEmail = urlParams.get('user_email') || hashParams.get('user_email');
        const userName = urlParams.get('user_name') || hashParams.get('user_name');
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
     * Refresh access token using refresh token
     *
     * Cookie-first (2026-08-15): o refresh_token HttpOnly é o portador no
     * deploy same-site — funciona mesmo SEM refresh no localStorage. Em 401
     * (cookie ausente/revogado) cai para o body legado (cross-site GitHub
     * Pages / localStorage).
     *
     * @returns {Promise<boolean|'offline'>} True if token refreshed successfully
     */
    async function refreshAccessToken() {
        const refreshToken = getRefreshToken();

        const baseUrl = AppConfig.api.backend.baseUrl;
        const refreshUrl = `${baseUrl}/auth/refresh`;

        // 1) Cookie-first: POST sem body, credentials include — o servidor
        //    lê o cookie refresh_token e ROTACIONA (revoga o jti antigo).
        try {
            console.log('[AuthService] Refreshing access token (cookie)...');

            const response = await fetch(refreshUrl, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                storeTokens({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_in: data.expires_in || 3600
                });
                console.log('[AuthService] ✓ Token refreshed successfully (cookie)');
                return true;
            }

            if (response.status !== 401) {
                console.error('[AuthService] Token refresh failed:', response.status);
                return false;
            }
            // 401 → cookie ausente/revogado: tenta o caminho legado abaixo
        } catch (error) {
            // FALHA DE REDE ≠ token inválido: retorna 'offline' para os
            // callers manterem as credenciais (logout só em erro HTTP).
            console.error('[AuthService] Token refresh error (network?):', error);
            return 'offline';
        }

        // 2) Fallback legado: body com refresh do localStorage (cross-site).
        // Omit cookies deliberately: a cookie-first attempt just failed, and
        // the backend prioritizes a refresh cookie over the explicit body. A
        // stale cookie must not shadow a still-valid cross-site local token.
        if (!refreshToken) {
            console.log('[AuthService] No refresh token available (cookie failed)');
            return false;
        }

        try {
            console.log('[AuthService] Refreshing access token (body legado)...');

            const response = await fetch(refreshUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'omit',
                body: JSON.stringify({ refresh_token: refreshToken })
            });

            if (!response.ok) {
                console.error('[AuthService] Token refresh failed:', response.status);
                return false;
            }

            const data = await response.json();

            // Store new tokens
            storeTokens({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in || 3600
            });

            console.log('[AuthService] ✓ Token refreshed successfully (body)');
            return true;

        } catch (error) {
            console.error('[AuthService] Token refresh error (network?):', error);
            return 'offline';
        }
    }

    /**
     * Schedule automatic token refresh before expiration
     */
    function scheduleTokenRefresh() {
        const expiry = getTokenExpiry();
        if (!expiry) {
            return;
        }

        const now = Date.now();
        const expiryTime = expiry;
        const timeUntilExpiry = expiryTime - now;
        
        // Refresh 5 minutes before expiration
        const refreshTime = timeUntilExpiry - (5 * 60 * 1000);

        if (refreshTime > 0) {
            console.log(`[AuthService] Token refresh scheduled in ${Math.round(refreshTime / 60000)} minutes`);
            
            setTimeout(async () => {
                console.log('[AuthService] Auto-refreshing token...');
                const success = await refreshAccessToken();
                
                if (success) {
                    // Schedule next refresh
                    scheduleTokenRefresh();
                } else {
                    console.warn('[AuthService] Auto-refresh failed - user may need to re-authenticate');
                }
            }, refreshTime);
        } else {
            // Token expires soon or already expired, try to refresh immediately
            console.log('[AuthService] Token expires soon, refreshing now...');
            refreshAccessToken().then(success => {
                if (success) {
                    scheduleTokenRefresh();
                }
            });
        }
    }

    /**
     * Initiate Google OAuth login flow
     */
    async function login() {
        try {
            console.log('[AuthService] Initiating Google OAuth login...');

            const baseUrl = AppConfig.api.backend.baseUrl;
            
            // Get current frontend URL for callback
            const currentUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
            const frontendUrl = currentUrl.replace(/\/$/, ''); // Remove trailing slash
            
            // Pass frontend URL to backend for dynamic redirect
            const authUrl = `${baseUrl}${ENDPOINTS.login}?callback_url=${encodeURIComponent(frontendUrl)}`;

            console.log(`[AuthService] Frontend URL: ${frontendUrl}`);
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
        const baseUrl = AppConfig.api.backend.baseUrl;
        const verifyUrl = `${baseUrl}${ENDPOINTS.verify}`;

        if (!token) {
            // Migração 2026-08-15: sem token local (?session=1 no deploy
            // same-site), o cookie HttpOnly é o portador — tenta verificar
            // via cookie, sem header Authorization.
            console.log('[AuthService] No local token — trying HttpOnly cookie...');
            try {
                const response = await fetch(verifyUrl, {
                    method: 'GET',
                    credentials: 'include'
                });

                if (response.ok) {
                    const userData = await response.json();
                    _currentUser = userData;
                    saveUserProfile(userData);  // identidade sobrevive a reload offline
                    console.log(`[AuthService] ✓ Cookie verified: ${userData.email}`);
                    return userData;
                }

                console.warn(`[AuthService] Cookie verification failed: ${response.status}`);
                return null;
            } catch (error) {
                console.error('[AuthService] Cookie verification error (network?):', error);
                const stored = getStoredUserProfile();
                if (stored) _currentUser = stored;
                return stored;
            }
        }

        try {
            console.log('[AuthService] Verifying token with backend...');

            const response = await fetch(verifyUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
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
            saveUserProfile(userData);  // identidade sobrevive a reload offline
            
            console.log('[AuthService] ✓ Token verified');
            console.log(`[AuthService] ✓ User: ${userData.email}`);
            console.log(`[AuthService] ✓ Authorized: ${userData.authorized}`);
            
            return userData;

        } catch (error) {
            // FALHA DE REDE (fetch rejeitou) — NÃO é token inválido: manter
            // credenciais e devolver o perfil persistido para uso offline.
            // (HTTP 401/403 já são tratados no branch !response.ok acima.)
            console.error('[AuthService] Token verification error (network?):', error);
            const stored = getStoredUserProfile();
            if (stored) _currentUser = stored;
            return stored;
        }
    }

    /**
     * Logout user and clear all auth data
     */
    async function logout() {
        try {
            // Notify backend to revoke tokens/session (2026-08-15: o backend
            // revoga o jti do refresh server-side). Bearer quando existe;
            // credentials inclui o cookie para os dois cenários (same-site).
            // No caminho cross-site legado, o refresh local é enviado no body
            // para que o servidor consiga revogar o jti correto.
            const baseUrl = AppConfig.api.backend.baseUrl;
            const logoutUrl = `${baseUrl}${ENDPOINTS.logout}`;
            const headers = {};
            const token = getToken();
            const refreshToken = getRefreshToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            if (refreshToken) {
                headers['Content-Type'] = 'application/json';
            }

            await fetch(logoutUrl, {
                method: 'POST',
                headers,
                credentials: 'include',
                ...(refreshToken ? { body: JSON.stringify({ refresh_token: refreshToken }) } : {})
            });
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
        // Query e fragment podem carregar access/refresh token no caminho
        // legado. Nunca serializar href/search/hash em logs.
        console.log('[AuthService] Location:', {
            path: window.location.pathname,
            hasQuery: !!window.location.search,
            hasFragment: !!window.location.hash
        });

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
            
            // CRITICAL: Store tokens BEFORE anything else
            // Live Server might reload the page, so we need to save immediately
            try {
                storeTokens(urlTokens);
                console.log('[AuthService] ✓ Tokens stored successfully');
            } catch (error) {
                console.error('[AuthService] ✗ Failed to store tokens:', error);
                throw error;
            }
            
            // Small delay to ensure localStorage write completes
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify tokens were saved
            const savedToken = getToken();
            const savedRefresh = getRefreshToken();
            console.log('[AuthService] Verification after storage:', {
                accessToken: savedToken ? 'present' : 'MISSING',
                refreshToken: savedRefresh ? 'present' : 'MISSING'
            });
            
            if (!savedToken) {
                console.error('[AuthService] ✗ CRITICAL: Tokens not saved to localStorage!');
                throw new Error('Failed to persist tokens');
            }
            
            cleanURL();
            sessionStorage.removeItem('oauth_callback_in_progress');
            console.log('[AuthService] ✓ OAuth callback complete');
        }

        // Step 2: Check for existing token in localStorage
        console.log('[AuthService] Checking localStorage...');
        const keys = getStorageKeys();
        console.log(`[AuthService]   Storage keys:`, keys);
        console.log(`[AuthService]   localStorage content:`, {
            oauthToken: localStorage.getItem(keys.oauthToken) ? 'present' : 'MISSING',
            oauthRefreshToken: localStorage.getItem(keys.oauthRefreshToken) ? 'present' : 'MISSING',
            oauthExpiry: localStorage.getItem(keys.oauthExpiry)
        });
        const hasToken = getToken() !== null;
        const hasRefreshToken = getRefreshToken() !== null;
        console.log(`[AuthService]   Has access token: ${hasToken}`);
        console.log(`[AuthService]   Has refresh token: ${hasRefreshToken}`);
        
        if (hasToken) {
            const expired = isTokenExpired();
            console.log(`[AuthService]   Access token expired: ${expired}`);
            
            // If token is expired but we have refresh token, try to refresh
            if (expired && hasRefreshToken) {
                console.log('[AuthService] Token expired, attempting refresh...');
                const refreshed = await refreshAccessToken();

                if (refreshed === true) {
                    console.log('[AuthService] ✓ Token refreshed successfully');
                    // Verify the new token
                    const user = await verifyToken();
                    if (user) {
                        scheduleTokenRefresh();
                        console.log('[AuthService] ========================================');
                        console.log('[AuthService] ✓ Initialization complete (token refreshed)');
                        console.log(`[AuthService] ✓ Logged in as: ${user.email}`);
                        console.log('[AuthService] ========================================');
                        _initialized = true;
                        return _currentUser;
                    }
                } else if (refreshed === 'offline') {
                    // sem rede: mantém credenciais e segue com o perfil persistido
                    console.log('[AuthService] Refresh offline — usando perfil persistido');
                    const stored = getStoredUserProfile();
                    if (stored) _currentUser = stored;
                    _initialized = true;
                    return _currentUser;
                } else {
                    console.log('[AuthService] ✗ Token refresh failed');
                    clearTokens();
                    _initialized = true;
                    return null;
                }
            }
        } else if (hasRefreshToken) {
            // No access token but have refresh token - try to get new access token
            console.log('[AuthService] No access token, but have refresh token. Attempting refresh...');
            const refreshed = await refreshAccessToken();

            if (refreshed === true) {
                const user = await verifyToken();
                if (user) {
                    scheduleTokenRefresh();
                    console.log('[AuthService] ========================================');
                    console.log('[AuthService] ✓ Initialization complete (restored from refresh token)');
                    console.log(`[AuthService] ✓ Logged in as: ${user.email}`);
                    console.log('[AuthService] ========================================');
                    _initialized = true;
                    return _currentUser;
                }
            } else if (refreshed === 'offline') {
                console.log('[AuthService] Refresh offline — usando perfil persistido');
                const stored = getStoredUserProfile();
                if (stored) _currentUser = stored;
                _initialized = true;
                return _currentUser;
            } else {
                console.log('[AuthService] ✗ Token refresh failed');
                clearTokens();
                _initialized = true;
                return null;
            }
        }

        if (isAuthenticated()) {
            console.log('[AuthService] Valid token found, verifying...');
            
            // Verify token with backend
            const user = await verifyToken();

            if (user) {
                // Schedule automatic token refresh
                scheduleTokenRefresh();
                
                console.log('[AuthService] ========================================');
                console.log('[AuthService] ✓ Initialization complete');
                console.log(`[AuthService] ✓ Logged in as: ${user.email}`);
                console.log('[AuthService] ========================================');
            } else {
                // Try to refresh token if verification failed
                console.log('[AuthService] Attempting token refresh after verification failure...');
                const refreshed = await refreshAccessToken();
                
                if (refreshed) {
                    // Verify new token
                    const user = await verifyToken();
                    if (user) {
                        scheduleTokenRefresh();
                        console.log('[AuthService] ✓ Token refreshed and verified');
                    }
                } else {
                    console.log('[AuthService] ========================================');
                    console.log('[AuthService] ✗ Token verification failed');
                    console.log('[AuthService] ========================================');
                }
            }
        } else {
            console.log('[AuthService] ========================================');
            console.log('[AuthService] No valid token found');
            console.log('[AuthService] ========================================');

            // ── Sessão por cookie (OAuth same-site, ?session=1) ────────────────
            // O callback do Render redireciona SEM tokens na URL (o cookie
            // HttpOnly é o portador desde 2026-08-15). Sem token local, a
            // sessão pode estar no cookie — verifica uma vez antes de cair
            // na tela de login. Sem isso, o login "volta ao início" sem
            // erro visível após validar no Google.
            console.log('[AuthService] Trying HttpOnly cookie session...');
            const cookieUser = await verifyToken();
            if (cookieUser) {
                console.log('[AuthService] ✓ Initialization complete (cookie session)');
                console.log(`[AuthService] ✓ Logged in as: ${cookieUser.email}`);
                if (new URLSearchParams(window.location.search).get('session') === '1') {
                    cleanURL();
                }
                _initialized = true;
                return cookieUser;
            }
        }

        // ── Dev Mode Auto-Login ────────────────────────────────────────────────
        // On localhost, if no valid auth, auto-fetch a dev token from backend.
        // Only works when backend ENVIRONMENT=development (blocked in production).
        if (!_currentUser && isLocalhost()) {
            console.log('[AuthService] 🔧 Dev mode detected — attempting auto-login...');
            const devToken = await fetchDevToken();
            if (devToken) {
                console.log('[AuthService] ✓ Dev auto-login successful');
                const user = await verifyToken();
                if (user) {
                    scheduleTokenRefresh();
                    console.log('[AuthService] ========================================');
                    console.log('[AuthService] ✓ Initialization complete (dev mode)');
                    console.log(`[AuthService] ✓ Logged in as: ${user.email}`);
                    console.log('[AuthService] ========================================');
                }
            } else {
                console.log('[AuthService] ✗ Dev auto-login failed (is backend running?)');
            }
        }

        _initialized = true;
        return _currentUser;
    }

    /**
     * Check if running on localhost (dev environment)
     * @returns {boolean}
     */
    function isLocalhost() {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');
    }

    /**
     * Fetch a dev token from the backend's /auth/dev-login endpoint.
     * Only works when backend has ENVIRONMENT=development.
     * @returns {Promise<Object|null>} Token data or null
     */
    async function fetchDevToken() {
        try {
            const baseUrl = AppConfig.api.backend.baseUrl;
            const devLoginUrl = `${baseUrl}/auth/dev-login`;

            console.log(`[AuthService] Calling dev-login: ${devLoginUrl}`);
            const response = await fetch(devLoginUrl);

            if (!response.ok) {
                const text = await response.text();
                console.warn(`[AuthService] Dev-login returned ${response.status}: ${text}`);
                return null;
            }

            const data = await response.json();
            console.log('[AuthService] ✓ Dev token received:', {
                hasAccessToken: !!data.access_token,
                hasRefreshToken: !!data.refresh_token,
                user: data.user_email
            });

            // Store the tokens
            storeTokens({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in
            });

            return data;
        } catch (error) {
            console.error('[AuthService] Dev-login fetch error:', error.message);
            return null;
        }
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
        clearTokens,
        refreshToken: refreshAccessToken  // Expose refresh function for ApiService
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
