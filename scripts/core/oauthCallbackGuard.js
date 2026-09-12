/**
 * File: oauthCallbackGuard.js
 * Purpose: Protege o boot durante o handshake OAuth (redirect e callback)
 * Dependencies: nenhuma (roda antes de qualquer módulo; só sessionStorage)
 *
 * Antes vivia como <script> inline no <head> do index.html. Foi extraído para
 * permitir CSP com script-src estrito: um bloco inline exigiria
 * 'unsafe-inline' (ou nonce por request, impossível num site estático), o que
 * anularia a proteção justamente contra script injetado.
 *
 * Responsabilidades:
 * - Se um redirect OAuth está em curso, não interferir na navegação.
 * - Se o callback está em curso, segurar o hot-reload do Live Server (o front
 *   local recarregava no meio da troca de tokens e perdia a sessão).
 * - Limpar as flags ao voltar do OAuth.
 */
(function () {
    // Check if OAuth redirect is in progress
    const oauthRedirectInProgress = sessionStorage.getItem('oauth_redirect_in_progress');
    const oauthCallbackInProgress = sessionStorage.getItem('oauth_callback_in_progress');

    if (oauthRedirectInProgress === 'true') {
        console.log('[OAuth Protection] 🔒 Redirect in progress - allowing navigation');
        // Don't clear - let the redirect happen
        return;
    }

    if (oauthCallbackInProgress === 'true') {
        console.log('[OAuth Protection] Callback in progress - preventing hot reload');

        // Disable Live Server hot reload temporarily
        if (window.stop) {
            window.stop(); // Modern browsers
        }

        // Mark as complete after 3 seconds (safety timeout)
        setTimeout(function () {
            if (sessionStorage.getItem('oauth_callback_in_progress') === 'true') {
                console.log('[OAuth Protection] Timeout reached - clearing protection');
                sessionStorage.removeItem('oauth_callback_in_progress');
            }
        }, 3000);
    }

    // Clear redirect flag if we're back from OAuth
    if (oauthRedirectInProgress) {
        sessionStorage.removeItem('oauth_redirect_in_progress');
    }
})();
