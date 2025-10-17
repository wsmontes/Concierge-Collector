/**
 * Force Refresh Script - Fixes checkbox rendering issue
 * 
 * This script forces the restaurant list to re-render with the new checkbox code.
 * Paste this into your browser console.
 */

(function() {
    console.log('%c🔄 Forcing Restaurant List Refresh...', 'font-size: 16px; font-weight: bold; color: #3B82F6;');
    
    if (!window.restaurantListModule) {
        console.log('%c❌ RestaurantListModule not found', 'color: #EF4444; font-weight: bold;');
        console.log('Try refreshing the page first (Cmd+Shift+R)');
        return;
    }
    
    // Force re-render
    console.log('Triggering renderRestaurantList()...');
    window.restaurantListModule.renderRestaurantList();
    
    // Check results
    setTimeout(() => {
        const checkboxes = document.querySelectorAll('.restaurant-checkbox');
        const cards = document.querySelectorAll('.restaurant-card');
        
        console.log(`%c✅ Re-render complete`, 'color: #10B981; font-weight: bold;');
        console.log(`   Restaurant cards: ${cards.length}`);
        console.log(`   Checkboxes: ${checkboxes.length}`);
        
        if (checkboxes.length > 0) {
            console.log('%c🎉 SUCCESS! Checkboxes are now visible!', 'font-size: 14px; font-weight: bold; color: #10B981; background: #D1FAE5; padding: 5px;');
            console.log('');
            console.log('Try clicking a checkbox - you should see:');
            console.log('1. Blue ring around the card');
            console.log('2. Bulk action toolbar at the bottom');
        } else {
            console.log('%c⚠️  Still no checkboxes', 'color: #F59E0B; font-weight: bold;');
            console.log('');
            console.log('This means the browser is still using cached JavaScript.');
            console.log('');
            console.log('%cNUCLEAR OPTION - Clear All Cache:', 'font-weight: bold;');
            console.log('1. Open DevTools Application tab');
            console.log('2. Click "Clear storage" (left sidebar)');
            console.log('3. Check ALL boxes');
            console.log('4. Click "Clear site data"');
            console.log('5. Refresh page (Cmd+Shift+R)');
            console.log('6. Re-enter password');
        }
    }, 100);
})();
