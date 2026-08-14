/**
 * File: curatorProfile.js
 * Purpose: Curator Profile Management - Display and manage authenticated curator
 * Dependencies: AuthService, ApiService, Logger
 * 
 * Main Responsibilities:
 * - Display curator profile with Google OAuth data (name, email, avatar)
 * - Sync curator data with MongoDB (users and curators collections)
 * - Provide UI for curator information display
 * - Handle curator profile updates
 */

const CuratorProfile = (function() {
    'use strict';

    const log = Logger ? Logger.module('CuratorProfile') : console;

    let _currentCurator = null;
    let _initialized = false;
    let docListenersBound = false;

    /**
     * Initialize curator profile from authenticated user
     * @returns {Promise<Object|null>} Curator data or null
     */
    async function initialize() {
        if (_initialized) {
            log.debug('Already initialized');
            return _currentCurator;
        }

        log.debug('========================================');
        log.debug('Initializing Curator Profile...');
        log.debug('========================================');

        try {
            // Get authenticated user from AuthService
            if (typeof AuthService === 'undefined') {
                log.warn('AuthService not available');
                return null;
            }

            const user = AuthService.getCurrentUser();
            if (!user) {
                log.debug('No authenticated user');
                return null;
            }

            log.debug(`User authenticated: ${user.email}`);
            log.debug(`  Name: ${user.name}`);
            log.debug(`  Picture: ${user.picture ? 'Yes' : 'No'}`);
            log.debug(`  Authorized: ${user.authorized}`);

            // Map user data to curator format
            _currentCurator = {
                curator_id: user.email,
                name: user.name,
                email: user.email,
                picture: user.picture,
                authorized: user.authorized
            };

            // Verify/create curator in MongoDB
            await ensureCuratorInDatabase();

            // Update UI
            updateUI();

            _initialized = true;
            log.debug('========================================');
            log.debug('✓ Curator Profile initialized');
            log.debug(`✓ Curator: ${_currentCurator.name}`);
            log.debug('========================================');

            return _currentCurator;

        } catch (error) {
            log.error('Failed to initialize curator profile:', error);
            return null;
        }
    }

    /**
     * Ensure curator exists in MongoDB curators collection
     * Backend creates curator during OAuth callback, but verify here as well
     */
    async function ensureCuratorInDatabase() {
        if (!_currentCurator) {
            log.warn('No curator data to save');
            return false;
        }

        try {
            log.debug('Verifying curator in database...');

            // Backend automatically creates/updates curator during OAuth callback
            // in auth.py: db.curators.update_one(..., upsert=True)
            // This verification confirms the curator exists
            
            log.debug('✓ Curator created/updated during OAuth callback');
            log.debug(`  curator_id: ${_currentCurator.curator_id}`);
            log.debug(`  Collection: users (email, google_id, authorized)`);
            log.debug(`  Collection: curators (curator_id, name, email, picture)`);
            log.debug('✓ Both collections linked via email/curator_id');
            
            return true;

        } catch (error) {
            log.error('Failed to verify curator in database:', error);
            return false;
        }
    }

    /**
     * Update UI with curator information - only updates header now
     */
    function updateUI() {
        if (!_currentCurator) {
            log.warn('No curator data to display');
            return;
        }

        try {
            // Update header profile with dropdown menu
            updateHeaderProfile();

            log.debug('✓ UI updated with curator profile');

        } catch (error) {
            log.error('Failed to update UI:', error);
        }
    }

    /**
     * Update header/navigation with curator profile and dropdown menu
     */
    function updateHeaderProfile() {
        // Check if there's a user profile area in header
        const headerProfile = document.getElementById('user-profile-header');

        if (headerProfile && _currentCurator) {
            const safeName = escapeHtml(_currentCurator.name);
            const safeEmail = escapeHtml(_currentCurator.email);
            const safePicture = escapeHtml(_currentCurator.picture);
            headerProfile.innerHTML = `
                <div class="relative" id="user-profile-dropdown-container">
                    <button 
                        id="user-profile-button"
                        class="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-haspopup="true"
                        aria-expanded="false"
                    >
                        ${_currentCurator.picture ? `
                            <img
                                src="${safePicture}"
                                alt="${safeName}"
                                class="w-8 h-8 sm:w-10 sm:h-10 rounded-full ring-2 ring-blue-200 object-cover flex-shrink-0"
                                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                            >
                            <div class="avatar-fallback w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold flex-shrink-0" style="display:none">
                                ${getInitials(_currentCurator.name)}
                            </div>
                        ` : `
                            <div class="avatar-fallback w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold flex-shrink-0">
                                ${getInitials(_currentCurator.name)}
                            </div>
                        `}
                        <div class="hidden sm:flex flex-col items-start">
                            <span class="text-sm font-semibold text-gray-900">${safeName}</span>
                            <span class="text-xs text-gray-500">${safeEmail}</span>
                        </div>
                        <span class="material-icons text-gray-400 ml-1">arrow_drop_down</span>
                    </button>
                    
                    <!-- Dropdown Menu -->
                    <div 
                        id="user-profile-dropdown"
                        class="hidden absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50"
                        role="menu"
                    >
                        <!-- User Info -->
                        <div class="px-4 py-3 border-b border-gray-100">
                            <p class="text-sm font-semibold text-gray-900">${safeName}</p>
                            <p class="text-xs text-gray-500">${safeEmail}</p>
                            <p class="text-xs text-green-600 mt-1 flex items-center gap-1">
                                <span class="material-icons text-sm">check_circle</span>
                                Authenticated via Google
                            </p>
                        </div>

                        <!-- Menu Items -->
                        <button
                            id="user-logout-btn"
                            class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                            role="menuitem"
                        >
                            <span class="material-icons text-gray-400 text-lg">logout</span>
                            Logout
                        </button>
                    </div>
                </div>
            `;
            
            // Document-level handlers registrados UMA única vez: o header é
            // re-renderizado a cada updateHeaderProfile, e registrar aqui
            // acumulava um par click/keydown novo por render (closures
            // órfãs apontando para elementos removidos do DOM)
            if (!docListenersBound) {
                docListenersBound = true;

                document.addEventListener('click', (e) => {
                    const button = document.getElementById('user-profile-button');
                    const dropdown = document.getElementById('user-profile-dropdown');
                    if (!button || !dropdown) return;
                    if (!dropdown.classList.contains('hidden') &&
                        !dropdown.contains(e.target) &&
                        !button.contains(e.target)) {
                        dropdown.classList.add('hidden');
                        button.setAttribute('aria-expanded', 'false');
                    }
                });

                document.addEventListener('keydown', (e) => {
                    if (e.key !== 'Escape') return;
                    const button = document.getElementById('user-profile-button');
                    const dropdown = document.getElementById('user-profile-dropdown');
                    if (!button || !dropdown) return;
                    if (!dropdown.classList.contains('hidden')) {
                        dropdown.classList.add('hidden');
                        button.setAttribute('aria-expanded', 'false');
                    }
                });
            }

            // Add event listeners after creating the HTML
            setTimeout(() => {
                const button = document.getElementById('user-profile-button');
                const dropdown = document.getElementById('user-profile-dropdown');
                const logoutBtn = document.getElementById('user-logout-btn');

                if (button && dropdown) {
                    // Toggle dropdown
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isHidden = dropdown.classList.contains('hidden');
                        dropdown.classList.toggle('hidden');
                        button.setAttribute('aria-expanded', !isHidden);
                    });
                }

                if (logoutBtn && window.AccessControl && typeof window.AccessControl.logout === 'function') {
                    logoutBtn.addEventListener('click', () => window.AccessControl.logout());
                }
            }, 100);
        }
    }

    /**
     * Escapa HTML — name/email/picture vêm do perfil Google e são interpolados
     * em innerHTML; sem escape, um display name malicioso vira HTML arbitrário
     * no header do collector (mesma classe do fix de auth_error).
     */
    function escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Get initials from name for avatar fallback
     * @param {string} name - Full name
     * @returns {string} Initials (max 2 letters)
     */
    function getInitials(name) {
        if (!name) return '?';
        
        const parts = name.trim().split(' ');
        if (parts.length === 1) {
            return parts[0].charAt(0).toUpperCase();
        }
        
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    /**
     * Get current curator data
     * @returns {Object|null} Curator object or null
     */
    function getCurrentCurator() {
        return _currentCurator;
    }

    /**
     * Check if curator profile is initialized
     * @returns {boolean}
     */
    function isInitialized() {
        return _initialized;
    }

    /**
     * Reset curator profile (on logout)
     */
    function reset() {
        _currentCurator = null;
        _initialized = false;
        
        // Clear header UI only (curator card was removed)
        const headerProfile = document.getElementById('user-profile-header');
        if (headerProfile) {
            headerProfile.innerHTML = '';
        }
        
        log.debug('Curator profile reset');
    }

    /**
     * Public API
     */
    return {
        initialize,
        getCurrentCurator,
        isInitialized,
        reset,
        updateUI
    };
})();

// Expose globally
if (typeof window !== 'undefined') {
    window.CuratorProfile = CuratorProfile;
}
