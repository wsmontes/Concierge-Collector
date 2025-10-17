/**
 * Code Comparison Script
 * This will show you what code the browser actually loaded
 */

(function() {
    console.clear();
    console.log('%c🔍 Checking Loaded Code vs Disk', 'font-size: 18px; font-weight: bold; color: #3B82F6;');
    console.log('═════════════════════════════════');
    console.log('');
    
    // Check if renderRestaurantCard exists
    if (!window.restaurantListModule || !window.restaurantListModule.renderRestaurantCard) {
        console.log('%c❌ renderRestaurantCard method not found!', 'color: #EF4444; font-weight: bold;');
        return;
    }
    
    // Get the actual function code
    const functionCode = window.restaurantListModule.renderRestaurantCard.toString();
    
    // Check for checkbox
    const hasCheckbox = functionCode.includes('restaurant-checkbox');
    const hasAbsoluteDiv = functionCode.includes('absolute top-2 left-2');
    const hasIsSelected = functionCode.includes('isSelected');
    const hasRingBlue = functionCode.includes('ring-blue-500');
    
    console.log('%c📋 Function Analysis:', 'font-weight: bold;');
    console.log('');
    console.log(`Contains 'restaurant-checkbox': ${hasCheckbox ? '✅' : '❌'}`);
    console.log(`Contains 'absolute top-2 left-2': ${hasAbsoluteDiv ? '✅' : '❌'}`);
    console.log(`Contains 'isSelected' variable: ${hasIsSelected ? '✅' : '❌'}`);
    console.log(`Contains 'ring-blue-500': ${hasRingBlue ? '✅' : '❌'}`);
    console.log('');
    
    if (!hasCheckbox) {
        console.log('%c⚠️  BROWSER HAS OLD CODE!', 'font-size: 16px; font-weight: bold; color: #EF4444; background: #FEE2E2; padding: 5px;');
        console.log('');
        console.log('The browser loaded an old cached version of the JavaScript file.');
        console.log('');
        console.log('%cFunction code loaded by browser:', 'font-weight: bold;');
        console.log('%c' + functionCode.substring(0, 1000) + '...', 'font-family: monospace; font-size: 10px; background: #F3F4F6; padding: 10px;');
        console.log('');
        console.log('%c🔧 SOLUTION:', 'font-size: 14px; font-weight: bold; color: #F59E0B;');
        console.log('');
        console.log('Option 1 - Disable cache in DevTools:');
        console.log('  1. Open DevTools Network tab');
        console.log('  2. Check "Disable cache" checkbox');
        console.log('  3. Keep DevTools open');
        console.log('  4. Refresh page (Cmd+Shift+R)');
        console.log('');
        console.log('Option 2 - Clear site data:');
        console.log('  1. DevTools → Application → Storage');
        console.log('  2. Click "Clear site data"');
        console.log('  3. Refresh page');
        console.log('  4. Re-enter password');
        console.log('');
        console.log('Option 3 - Add cache busting (prevents this issue):');
        console.log('  Edit index.html and add ?v=timestamp to script tags');
        
    } else {
        console.log('%c✅ BROWSER HAS NEW CODE!', 'font-size: 16px; font-weight: bold; color: #10B981; background: #D1FAE5; padding: 5px;');
        console.log('');
        console.log('The checkbox code is loaded. The issue must be elsewhere.');
        console.log('');
        console.log('Let me check the actual rendering...');
        console.log('');
        
        // Try to get a restaurant to test with
        if (window.restaurantListModule.restaurants && window.restaurantListModule.restaurants.length > 0) {
            const testRestaurant = window.restaurantListModule.restaurants[0];
            console.log('Testing with restaurant:', testRestaurant.name);
            console.log('');
            
            const cardHTML = window.restaurantListModule.renderRestaurantCard(testRestaurant);
            
            console.log('%cGenerated card HTML:', 'font-weight: bold;');
            console.log('%c' + cardHTML.substring(0, 800), 'font-family: monospace; font-size: 10px; background: #F3F4F6; padding: 10px;');
            
            if (cardHTML.includes('restaurant-checkbox')) {
                console.log('');
                console.log('%c✅ Checkbox IS in the generated HTML!', 'color: #10B981; font-weight: bold;');
                console.log('');
                console.log('The problem might be:');
                console.log('1. HTML is being generated but not inserted into DOM');
                console.log('2. Something is overwriting the HTML after rendering');
                console.log('3. CSS is hiding the checkboxes');
                console.log('');
                console.log('Checking DOM now...');
                
                const container = document.getElementById('restaurant-list-container');
                if (container) {
                    console.log('Container HTML (first 1000 chars):');
                    console.log('%c' + container.innerHTML.substring(0, 1000), 'font-family: monospace; font-size: 10px;');
                }
            }
        } else {
            console.log('No restaurants loaded to test with.');
        }
    }
    
    console.log('');
    console.log('═════════════════════════════════');
})();
