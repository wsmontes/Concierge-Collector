/**
 * Concierge Collector - Bulk Operations Verification Script
 * 
 * Paste this entire script into your browser console to verify
 * that all bulk operation features are properly loaded and working.
 * 
 * Date: October 17, 2025
 */

(function() {
    console.clear();
    console.log('%c🔍 Concierge Collector - Bulk Operations Verification', 'font-size: 18px; font-weight: bold; color: #3B82F6;');
    console.log('%c═══════════════════════════════════════════════════════', 'color: #3B82F6;');
    console.log('');

    const results = {
        passed: [],
        failed: [],
        warnings: []
    };

    function test(name, condition, errorMsg = '') {
        if (condition) {
            results.passed.push(name);
            console.log(`%c✅ ${name}`, 'color: #10B981;');
            return true;
        } else {
            results.failed.push({ name, error: errorMsg });
            console.log(`%c❌ ${name}`, 'color: #EF4444;');
            if (errorMsg) console.log(`   ${errorMsg}`);
            return false;
        }
    }

    function warn(name, message) {
        results.warnings.push({ name, message });
        console.log(`%c⚠️  ${name}`, 'color: #F59E0B;');
        console.log(`   ${message}`);
    }

    console.log('%c📦 Module Loading', 'font-size: 14px; font-weight: bold;');
    console.log('─────────────────');

    test(
        'RestaurantListModule class defined',
        typeof RestaurantListModule !== 'undefined',
        'The RestaurantListModule class is not loaded. Check if script loaded correctly.'
    );

    test(
        'window.restaurantListModule instance exists',
        !!window.restaurantListModule,
        'Module instance not found. Try hard refresh (Cmd+Shift+R) or manual initialization.'
    );

    test(
        'window.uiManager exists',
        !!window.uiManager,
        'UIManager not found. Application may not be initialized.'
    );

    test(
        'UIManager references RestaurantListModule',
        !!window.uiManager?.restaurantListModule,
        'UIManager does not have restaurantListModule property.'
    );

    console.log('');
    console.log('%c🎯 Selection Properties', 'font-size: 14px; font-weight: bold;');
    console.log('────────────────────────');

    if (window.restaurantListModule) {
        const module = window.restaurantListModule;

        test(
            'selectedRestaurants is a Set',
            module.selectedRestaurants instanceof Set,
            'selectedRestaurants should be a Set data structure.'
        );

        test(
            'selectionMode is boolean',
            typeof module.selectionMode === 'boolean',
            'selectionMode should be a boolean value.'
        );

        console.log(`   Current selection count: ${module.selectedRestaurants.size}`);
        console.log(`   Selection mode active: ${module.selectionMode}`);
    }

    console.log('');
    console.log('%c⚙️  Methods Available', 'font-size: 14px; font-weight: bold;');
    console.log('────────────────────────');

    if (window.restaurantListModule) {
        const module = window.restaurantListModule;

        test(
            'toggleSelection() method exists',
            typeof module.toggleSelection === 'function'
        );

        test(
            'updateBulkActionToolbar() method exists',
            typeof module.updateBulkActionToolbar === 'function'
        );

        test(
            'createBulkActionToolbar() method exists',
            typeof module.createBulkActionToolbar === 'function'
        );

        test(
            'exportSelected() method exists',
            typeof module.exportSelected === 'function'
        );

        test(
            'deleteSelected() method exists',
            typeof module.deleteSelected === 'function'
        );

        test(
            'clearSelection() method exists',
            typeof module.clearSelection === 'function'
        );
    }

    console.log('');
    console.log('%c🎨 DOM Elements', 'font-size: 14px; font-weight: bold;');
    console.log('─────────────────');

    const checkboxes = document.querySelectorAll('.restaurant-checkbox');
    const cards = document.querySelectorAll('.restaurant-card');
    const toolbar = document.getElementById('bulk-action-toolbar');

    test(
        'Restaurant cards exist',
        cards.length > 0,
        'No restaurant cards found in DOM. Make sure restaurants are loaded.'
    );

    console.log(`   Found ${cards.length} restaurant cards`);

    test(
        'Checkboxes rendered in cards',
        checkboxes.length > 0,
        'No checkboxes found. The card rendering may have an issue.'
    );

    console.log(`   Found ${checkboxes.length} checkboxes`);

    if (checkboxes.length > 0) {
        const firstCheckbox = checkboxes[0];
        
        test(
            'Checkboxes have restaurant ID data',
            !!firstCheckbox.dataset.restaurantId,
            'Checkboxes missing data-restaurant-id attribute.'
        );

        test(
            'Checkboxes have proper classes',
            firstCheckbox.classList.contains('restaurant-checkbox'),
            'Checkbox missing expected CSS class.'
        );

        console.log(`   Sample checkbox ID: ${firstCheckbox.dataset.restaurantId}`);
    }

    if (toolbar) {
        console.log('   ✅ Bulk action toolbar exists (currently visible)');
    } else {
        warn(
            'Bulk action toolbar not in DOM',
            'Toolbar will be created when first item is selected. This is normal.'
        );
    }

    console.log('');
    console.log('%c🔌 Dependencies', 'font-size: 14px; font-weight: bold;');
    console.log('─────────────────');

    test(
        'dataStorage available',
        !!window.dataStorage,
        'dataStorage dependency not found.'
    );

    if (window.dataStorage) {
        test(
            'transformToV2Format() method exists',
            typeof window.dataStorage.transformToV2Format === 'function',
            'transformToV2Format method not found in dataStorage.'
        );

        test(
            'smartDeleteRestaurant() method exists',
            typeof window.dataStorage.smartDeleteRestaurant === 'function',
            'smartDeleteRestaurant method not found in dataStorage.'
        );
    }

    test(
        'uiUtils available',
        !!window.uiUtils,
        'uiUtils dependency not found.'
    );

    test(
        'SafetyUtils available',
        !!window.SafetyUtils || typeof SafetyUtils !== 'undefined',
        'SafetyUtils not found.'
    );

    console.log('');
    console.log('%c📊 Summary', 'font-size: 16px; font-weight: bold;');
    console.log('══════════');
    console.log('');

    console.log(`%c✅ Passed: ${results.passed.length}`, 'color: #10B981; font-weight: bold;');
    console.log(`%c❌ Failed: ${results.failed.length}`, results.failed.length > 0 ? 'color: #EF4444; font-weight: bold;' : 'color: #6B7280;');
    console.log(`%c⚠️  Warnings: ${results.warnings.length}`, results.warnings.length > 0 ? 'color: #F59E0B; font-weight: bold;' : 'color: #6B7280;');

    console.log('');

    if (results.failed.length === 0 && results.warnings.length <= 1) {
        console.log('%c🎉 ALL SYSTEMS GO!', 'font-size: 20px; font-weight: bold; color: #10B981; background: #D1FAE5; padding: 10px;');
        console.log('');
        console.log('%cBulk operations are fully functional!', 'color: #10B981; font-weight: bold;');
        console.log('');
        console.log('Try it out:');
        console.log('1. Click a checkbox on any restaurant card');
        console.log('2. Watch the blue ring appear and toolbar show up');
        console.log('3. Select multiple restaurants');
        console.log('4. Use the toolbar to export or delete selected items');
        console.log('');

        // Show quick test example
        console.log('%c🧪 Quick Test (paste this):', 'font-weight: bold;');
        console.log('%cconst firstRestaurantId = parseInt(document.querySelector(".restaurant-checkbox").dataset.restaurantId);\nwindow.restaurantListModule.toggleSelection(firstRestaurantId);\nconsole.log("Selected:", window.restaurantListModule.selectedRestaurants);', 'background: #F3F4F6; padding: 5px; font-family: monospace;');

    } else {
        console.log('%c⚠️  ISSUES DETECTED', 'font-size: 20px; font-weight: bold; color: #EF4444; background: #FEE2E2; padding: 10px;');
        console.log('');

        if (results.failed.length > 0) {
            console.log('%cFailed Checks:', 'color: #EF4444; font-weight: bold;');
            results.failed.forEach(({ name, error }) => {
                console.log(`  • ${name}`);
                if (error) console.log(`    ${error}`);
            });
            console.log('');
        }

        console.log('%c🔧 Recommended Actions:', 'font-weight: bold;');
        console.log('');
        console.log('1. Hard Refresh Browser:');
        console.log('   Mac: Cmd + Shift + R');
        console.log('   Windows: Ctrl + Shift + R');
        console.log('');
        console.log('2. Clear Browser Cache:');
        console.log('   DevTools → Application → Clear Storage → Clear site data');
        console.log('');
        console.log('3. Manual Initialization (paste this):');
        console.log('%cif (window.uiManager && !window.restaurantListModule && typeof RestaurantListModule !== "undefined") {\n    window.restaurantListModule = new RestaurantListModule();\n    window.restaurantListModule.init({\n        dataStorage: window.dataStorage,\n        uiUtils: window.uiUtils\n    });\n    window.uiManager.restaurantListModule = window.restaurantListModule;\n    console.log("✅ Manually initialized RestaurantListModule");\n    location.reload();\n}', 'background: #F3F4F6; padding: 5px; font-family: monospace;');
    }

    console.log('');
    console.log('%c═══════════════════════════════════════════════════════', 'color: #3B82F6;');
    console.log('');

    // Return results object for programmatic access
    return {
        success: results.failed.length === 0,
        passed: results.passed.length,
        failed: results.failed.length,
        warnings: results.warnings.length,
        details: results
    };
})();
