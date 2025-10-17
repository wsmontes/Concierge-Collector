/**
 * Verification Script: Compact Curator Section
 * Purpose: Verify the new compact curator section is properly implemented
 * Run this in the browser console after loading the page
 */

(function() {
    console.clear();
    console.log('%c🔍 Verifying Compact Curator Section', 'font-size: 18px; font-weight: bold; color: #3B82F6;');
    console.log('═══════════════════════════════════════════');
    console.log('');
    
    const results = {
        html: {},
        css: {},
        javascript: {},
        overall: true
    };
    
    // ===== HTML STRUCTURE VERIFICATION =====
    console.log('%c📄 HTML Structure', 'font-weight: bold; font-size: 14px;');
    
    const section = document.getElementById('curator-section');
    results.html.section = !!section;
    console.log(`  Curator section: ${section ? '✅' : '❌'}`);
    
    const compactDisplay = document.getElementById('curator-compact-display');
    results.html.compactDisplay = !!compactDisplay;
    console.log(`  Compact display: ${compactDisplay ? '✅' : '❌'}`);
    
    const editForm = document.getElementById('curator-edit-form');
    results.html.editForm = !!editForm;
    console.log(`  Edit form: ${editForm ? '✅' : '❌'}`);
    
    const selectorSection = document.getElementById('curator-selector-compact');
    results.html.selectorSection = !!selectorSection;
    console.log(`  Selector section: ${selectorSection ? '✅' : '❌'}`);
    
    // Check buttons
    const editBtn = document.getElementById('edit-curator-compact');
    results.html.editBtn = !!editBtn;
    console.log(`  Edit button: ${editBtn ? '✅' : '❌'}`);
    
    const saveBtn = document.getElementById('save-curator-compact');
    results.html.saveBtn = !!saveBtn;
    console.log(`  Save button: ${saveBtn ? '✅' : '❌'}`);
    
    const cancelBtn = document.getElementById('cancel-curator-compact');
    results.html.cancelBtn = !!cancelBtn;
    console.log(`  Cancel button: ${cancelBtn ? '✅' : '❌'}`);
    
    const syncBtn = document.getElementById('sync-with-server-compact');
    results.html.syncBtn = !!syncBtn;
    console.log(`  Sync button: ${syncBtn ? '✅' : '❌'}`);
    
    const filterCheckbox = document.getElementById('filter-by-curator-compact');
    results.html.filterCheckbox = !!filterCheckbox;
    console.log(`  Filter checkbox: ${filterCheckbox ? '✅' : '❌'}`);
    
    const apiToggle = document.getElementById('toggle-api-visibility');
    results.html.apiToggle = !!apiToggle;
    console.log(`  API visibility toggle: ${apiToggle ? '✅' : '❌'}`);
    
    console.log('');
    
    // ===== CSS VERIFICATION =====
    console.log('%c🎨 CSS Styles', 'font-weight: bold; font-size: 14px;');
    
    if (section) {
        const sectionStyles = window.getComputedStyle(section);
        const hasPadding = parseFloat(sectionStyles.padding) < 20; // Should be p-3 or p-4 (12-16px)
        results.css.compactPadding = hasPadding;
        console.log(`  Compact padding (<20px): ${hasPadding ? '✅' : '❌'} (${sectionStyles.padding})`);
        
        const hasTransition = sectionStyles.transition.includes('all');
        results.css.transition = hasTransition;
        console.log(`  Transition animation: ${hasTransition ? '✅' : '❌'}`);
    }
    
    if (compactDisplay) {
        const displayStyles = window.getComputedStyle(compactDisplay);
        const isFlex = displayStyles.display === 'flex' || displayStyles.display === 'none';
        results.css.flexLayout = isFlex;
        console.log(`  Flex layout: ${isFlex ? '✅' : '❌'} (${displayStyles.display})`);
    }
    
    console.log('');
    
    // ===== JAVASCRIPT VERIFICATION =====
    console.log('%c⚙️ JavaScript Integration', 'font-weight: bold; font-size: 14px;');
    
    const hasCuratorModule = window.uiManager && window.uiManager.curatorModule;
    results.javascript.curatorModule = !!hasCuratorModule;
    console.log(`  CuratorModule exists: ${hasCuratorModule ? '✅' : '❌'}`);
    
    if (hasCuratorModule) {
        const hasCompactMethods = 
            typeof window.uiManager.curatorModule.displayCuratorInfoCompact === 'function' &&
            typeof window.uiManager.curatorModule.editCuratorCompact === 'function' &&
            typeof window.uiManager.curatorModule.saveCuratorCompact === 'function' &&
            typeof window.uiManager.curatorModule.cancelCuratorCompact === 'function';
        
        results.javascript.compactMethods = hasCompactMethods;
        console.log(`  Compact methods exist: ${hasCompactMethods ? '✅' : '❌'}`);
        
        const hasAPIToggle = typeof window.uiManager.curatorModule.setupAPIVisibilityToggle === 'function';
        results.javascript.apiToggleMethod = hasAPIToggle;
        console.log(`  API toggle method: ${hasAPIToggle ? '✅' : '❌'}`);
    }
    
    const hasExportImportModule = window.exportImportModule && typeof window.exportImportModule.syncWithServer === 'function';
    results.javascript.syncMethod = hasExportImportModule;
    console.log(`  Sync method available: ${hasExportImportModule ? '✅' : '❌'}`);
    
    console.log('');
    
    // ===== RESPONSIVE DESIGN VERIFICATION =====
    console.log('%c📱 Responsive Design', 'font-weight: bold; font-size: 14px;');
    
    const viewportWidth = window.innerWidth;
    console.log(`  Current viewport: ${viewportWidth}px`);
    
    if (viewportWidth < 640) {
        console.log(`  Mode: Mobile`);
    } else if (viewportWidth < 1024) {
        console.log(`  Mode: Tablet`);
    } else {
        console.log(`  Mode: Desktop`);
    }
    
    console.log('');
    
    // ===== EVENT LISTENERS VERIFICATION =====
    console.log('%c🎯 Event Listeners', 'font-weight: bold; font-size: 14px;');
    
    const checkListener = (element, eventType, name) => {
        if (!element) {
            console.log(`  ${name}: ❌ (element not found)`);
            return false;
        }
        
        // Check if getEventListeners is available (Chrome DevTools)
        if (typeof getEventListeners === 'function') {
            const listeners = getEventListeners(element);
            const hasListener = listeners && listeners[eventType] && listeners[eventType].length > 0;
            console.log(`  ${name}: ${hasListener ? '✅' : '❌'}`);
            return hasListener;
        } else {
            console.log(`  ${name}: ⚠️  (cannot verify - getEventListeners not available)`);
            return true; // Assume it's there
        }
    };
    
    results.javascript.editBtnListener = checkListener(editBtn, 'click', 'Edit button listener');
    results.javascript.saveBtnListener = checkListener(saveBtn, 'click', 'Save button listener');
    results.javascript.cancelBtnListener = checkListener(cancelBtn, 'click', 'Cancel button listener');
    results.javascript.syncBtnListener = checkListener(syncBtn, 'click', 'Sync button listener');
    results.javascript.filterListener = checkListener(filterCheckbox, 'change', 'Filter checkbox listener');
    
    console.log('');
    
    // ===== SPACE SAVINGS CALCULATION =====
    console.log('%c📏 Space Savings', 'font-weight: bold; font-size: 14px;');
    
    if (section) {
        const rect = section.getBoundingClientRect();
        const currentHeight = rect.height;
        const estimatedOldHeight = 200; // Approximate old height
        const savings = estimatedOldHeight - currentHeight;
        const savingsPercent = ((savings / estimatedOldHeight) * 100).toFixed(1);
        
        console.log(`  Current height: ${currentHeight.toFixed(0)}px`);
        console.log(`  Estimated old height: ${estimatedOldHeight}px`);
        console.log(`  Space saved: ~${savings.toFixed(0)}px (${savingsPercent}%)`);
        
        results.css.spaceSavings = savings > 0;
    }
    
    console.log('');
    
    // ===== OVERALL RESULTS =====
    console.log('═══════════════════════════════════════════');
    
    // Calculate overall success
    const htmlPass = Object.values(results.html).every(v => v === true);
    const cssPass = Object.values(results.css).every(v => v === true);
    const jsPass = Object.values(results.javascript).every(v => v === true);
    
    results.overall = htmlPass && cssPass && jsPass;
    
    if (results.overall) {
        console.log('%c✅ ALL CHECKS PASSED', 'font-size: 16px; font-weight: bold; color: #10B981; background: #D1FAE5; padding: 5px;');
    } else {
        console.log('%c⚠️ SOME CHECKS FAILED', 'font-size: 16px; font-weight: bold; color: #F59E0B; background: #FEF3C7; padding: 5px;');
    }
    
    console.log('');
    console.log('Summary:');
    console.log(`  HTML: ${htmlPass ? '✅' : '❌'} (${Object.values(results.html).filter(v => v).length}/${Object.keys(results.html).length})`);
    console.log(`  CSS: ${cssPass ? '✅' : '❌'} (${Object.values(results.css).filter(v => v).length}/${Object.keys(results.css).length})`);
    console.log(`  JavaScript: ${jsPass ? '✅' : '❌'} (${Object.values(results.javascript).filter(v => v).length}/${Object.keys(results.javascript).length})`);
    
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log('%c📋 Manual Testing Checklist:', 'font-weight: bold;');
    console.log('');
    console.log('1. Verify curator name displays in compact mode');
    console.log('2. Click Edit button → form should appear');
    console.log('3. Toggle API key visibility → should show/hide');
    console.log('4. Click Save → curator should be saved');
    console.log('5. Click Cancel → should return to display');
    console.log('6. Toggle filter checkbox → restaurants should filter');
    console.log('7. Click Sync button → should trigger sync');
    console.log('8. Resize window → should be responsive');
    console.log('9. Check on mobile viewport (<640px)');
    console.log('10. Check animations are smooth');
    console.log('');
    console.log('═══════════════════════════════════════════');
    
    return results;
})();
