/**
 * File: platformDetection.js
 * Purpose: Marca o documento com classes de plataforma usadas pelo CSS
 * Dependencies: nenhuma
 *
 * Extraído do <script> inline no <head> do index.html para permitir CSP com
 * script-src estrito (bloco inline exigiria 'unsafe-inline').
 *
 * Responsabilidades:
 * - Adicionar `is-ios` no <html> quando o user-agent é iOS, para os ajustes de
 *   CSS específicos (o Safari mobile não dispara alguns eventos como o resto).
 */
document.addEventListener('DOMContentLoaded', function () {
    const userAgent = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
    if (isIOS) {
        document.documentElement.classList.add('is-ios');
    }
});
