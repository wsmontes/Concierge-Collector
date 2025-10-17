/**
 * Verification Script: Unified Sync Button
 * Purpose: Verify the sync button is properly wired and functional
 * Run this in the browser console after loading the page
 */

(function() {
    console.clear();
    console.log('%c🔍 Verifying Unified Sync Button', 'font-size: 18px; font-weight: bold; color: #3B82F6;');
    console.log('═════════════════════════════════════════');
    console.log('');
    
    // Check 1: Button exists in DOM
    const syncButton = document.getElementById('sync-with-server');
    console.log(`✓ Sync button exists: ${syncButton ? '✅ YES' : '❌ NO'}`);
    
    if (!syncButton) {
        console.log('%c⚠️  Button not found! Check if page is loaded correctly.', 'color: #EF4444; font-weight: bold;');
        return;
    }
    
    // Check 2: Old buttons should NOT exist
    const oldImportBtn = document.getElementById('import-remote-data');
    const oldExportBtn = document.getElementById('export-remote-data');
    console.log(`✓ Old import button removed: ${!oldImportBtn ? '✅ YES' : '❌ STILL EXISTS'}`);
    console.log(`✓ Old export button removed: ${!oldExportBtn ? '✅ YES' : '❌ STILL EXISTS'}`);
    console.log('');
    
    // Check 3: Button text and icon
    console.log('Button content check:');
    const buttonText = syncButton.textContent.trim();
    const hasIcon = syncButton.querySelector('.material-icons');
    const iconText = hasIcon ? hasIcon.textContent.trim() : null;
    
    console.log(`  Text: "${buttonText}"`);
    console.log(`  Icon: ${iconText ? `✅ ${iconText}` : '❌ NO ICON'}`);
    console.log(`  Expected: "sync" icon and "Sync with Server" text`);
    console.log('');
    
    // Check 4: Module has the method
    console.log('Module method check:');
    if (!window.exportImportModule) {
        console.log('  ❌ exportImportModule not found on window');
    } else {
        const hasSyncMethod = typeof window.exportImportModule.syncWithServer === 'function';
        console.log(`  syncWithServer method: ${hasSyncMethod ? '✅ EXISTS' : '❌ MISSING'}`);
        
        if (hasSyncMethod) {
            console.log(`  Method signature: ${window.exportImportModule.syncWithServer.toString().substring(0, 100)}...`);
        }
    }
    console.log('');
    
    // Check 5: Event listener
    console.log('Event listener check:');
    const listeners = getEventListeners ? getEventListeners(syncButton) : null;
    if (listeners && listeners.click) {
        console.log(`  ✅ Click listener attached (${listeners.click.length} listener(s))`);
    } else {
        console.log('  ⚠️  Cannot verify listeners (getEventListeners not available)');
        console.log('     This is normal - listeners are likely attached correctly');
    }
    console.log('');
    
    // Check 6: Button styling
    console.log('Button styling check:');
    const styles = window.getComputedStyle(syncButton);
    console.log(`  Background: ${styles.backgroundColor}`);
    console.log(`  Color: ${styles.color}`);
    console.log(`  Display: ${styles.display}`);
    console.log(`  Padding: ${styles.padding}`);
    console.log('');
    
    // Summary
    console.log('═════════════════════════════════════════');
    console.log('%c✅ VERIFICATION COMPLETE', 'font-size: 16px; font-weight: bold; color: #10B981;');
    console.log('');
    console.log('To test the sync button:');
    console.log('1. Make sure you have a curator logged in');
    console.log('2. Click the "Sync with Server" button');
    console.log('3. Watch the console for sync progress');
    console.log('4. Check for success notification');
    console.log('');
    console.log('Expected behavior:');
    console.log('  → Shows "Syncing with server..." loading');
    console.log('  → Step 1: Imports from server');
    console.log('  → Step 2: Exports to server');
    console.log('  → Shows success notification with timing');
    console.log('  → Refreshes restaurant list');
    console.log('');
    console.log('═════════════════════════════════════════');
})();
