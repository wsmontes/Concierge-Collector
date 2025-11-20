/**
 * DEBUG SCRIPT - Loop Investigation
 * 
 * COMO USAR:
 * 1. Abra o index.html no browser
 * 2. Abra o DevTools (F12)
 * 3. Cole este código inteiro no console
 * 4. Veja os logs de todas as chamadas a startApplication
 */

console.clear();
console.log('🔍 DEBUG: Interceptando chamadas a startApplication...\n');

// Salvar a função original
const originalStartApplication = window.startApplication;

// Contador de chamadas
let callCount = 0;

// Interceptar e logar todas as chamadas
window.startApplication = function() {
    callCount++;
    
    console.group(`🔴 startApplication CALL #${callCount}`);
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('📍 Call Stack:');
    console.trace();
    console.groupEnd();
    
    // Chamar a função original (se existir)
    if (originalStartApplication && typeof originalStartApplication === 'function') {
        return originalStartApplication.apply(this, arguments);
    }
};

// Monitorar o localStorage para ver hasAccess
console.log('🔑 Access Control Status:');
console.log('  - hasAccess:', localStorage.getItem('concierge_access_granted'));
console.log('  - timestamp:', localStorage.getItem('concierge_access_timestamp'));

// Monitorar eventos DOMContentLoaded
const domLoadedListeners = [];
const originalAddEventListener = document.addEventListener;
document.addEventListener = function(event, handler, ...args) {
    if (event === 'DOMContentLoaded') {
        domLoadedListeners.push({
            handler: handler.toString().substring(0, 100),
            stack: new Error().stack
        });
        console.log('📌 DOMContentLoaded listener added:', {
            handler: handler.toString().substring(0, 100) + '...',
            stack: new Error().stack
        });
    }
    return originalAddEventListener.call(this, event, handler, ...args);
};

console.log('\n✅ Debug script instalado! Recarregue a página para ver os logs.\n');
