/**
 * Access Control Module
 * 
 * Purpose: Prevent accidental access to the application by unauthorized users.
 * 
 * Features:
 * - Simple password gate on first visit
 * - Password stored in localStorage (persistent across sessions)
 * - No encryption (just UI visibility control)
 * - Zero friction after initial unlock
 * 
 * Dependencies: None
 * 
 * Security Level: Prevents accidental access only (not secure against intentional access)
 */

const AccessControl = (function() {
    'use strict';

    const STORAGE_KEY = 'concierge_access_granted';
    const CORRECT_PASSWORD = 'concierge2025'; // Change this to your preferred password

    /**
     * Check if user has previously entered correct password
     */
    function hasAccess() {
        const stored = localStorage.getItem(STORAGE_KEY);
        console.log(`AccessControl: Checking access. Storage key "${STORAGE_KEY}" = "${stored}"`);
        return stored === 'true';
    }

    /**
     * Grant access by storing flag in localStorage
     */
    function grantAccess() {
        localStorage.setItem(STORAGE_KEY, 'true');
        console.log(`AccessControl: Access granted. Storage key "${STORAGE_KEY}" set to "true"`);
        console.log('AccessControl: Verifying storage:', localStorage.getItem(STORAGE_KEY));
    }

    /**
     * Verify password and grant access if correct
     */
    function verifyPassword(password) {
        console.log('AccessControl: Verifying password...');
        if (password === CORRECT_PASSWORD) {
            grantAccess();
            return true;
        }
        console.log('AccessControl: Incorrect password');
        return false;
    }

    /**
     * Show password prompt overlay
     */
    function showPasswordPrompt() {
        const overlay = document.createElement('div');
        overlay.id = 'access-control-overlay';
        overlay.innerHTML = `
            <div class="access-control-container">
                <div class="access-control-card">
                    <img src="images/Lotier_Logo.webp" alt="Lotier Logo" class="access-control-logo">
                    <h1>Collector</h1>
                    <p>Enter password to access</p>
                    <input 
                        type="password" 
                        id="access-password" 
                        placeholder="Enter password"
                        autocomplete="off"
                    />
                    <button id="access-submit">
                        <span class="material-icons" style="font-size: 20px;">lock_open</span>
                        Unlock
                    </button>
                    <div id="access-error" class="access-error"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        const passwordInput = document.getElementById('access-password');
        const submitButton = document.getElementById('access-submit');
        const errorDiv = document.getElementById('access-error');

        function attemptUnlock() {
            const password = passwordInput.value;
            
            if (verifyPassword(password)) {
                overlay.remove();
                initializeApp();
            } else {
                errorDiv.textContent = 'Incorrect password';
                passwordInput.value = '';
                passwordInput.focus();
            }
        }

        submitButton.addEventListener('click', attemptUnlock);
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                attemptUnlock();
            }
        });

        // Focus password input
        setTimeout(() => passwordInput.focus(), 100);
    }

    /**
     * Initialize the application (called after access is granted)
     */
    function initializeApp() {
        // Wait for window.startApplication to be defined by main.js
        const checkAndStart = () => {
            if (typeof window.startApplication === 'function') {
                window.startApplication();
            } else {
                console.log('Waiting for main.js to load...');
                setTimeout(checkAndStart, 50);
            }
        };
        checkAndStart();
    }

    /**
     * Check access and show prompt if needed
     */
    function checkAccess() {
        if (hasAccess()) {
            console.log('Access granted - user previously authenticated');
            // User has access, initialize app when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initializeApp);
            } else {
                initializeApp();
            }
        } else {
            console.log('No access - showing password prompt');
            showPasswordPrompt();
        }
    }

    /**
     * Reset access (for testing or revoking access)
     */
    function resetAccess() {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }

    // Public API
    return {
        checkAccess,
        resetAccess,
        hasAccess
    };
})();

// Auto-check access when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AccessControl.checkAccess());
} else {
    AccessControl.checkAccess();
}
