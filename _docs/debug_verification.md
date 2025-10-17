# Debug Verification Guide

## Quick Verification Steps

### 1. Check Module Availability
Open browser console and run:

```javascript
// Check if RestaurantListModule class is defined
console.log('RestaurantListModule:', typeof RestaurantListModule);

// Check if instance exists
console.log('window.restaurantListModule:', window.restaurantListModule);

// Check UIManager
console.log('window.uiManager:', window.uiManager);
console.log('uiManager.restaurantListModule:', window.uiManager?.restaurantListModule);
```

**Expected Output:**
```
RestaurantListModule: function
window.restaurantListModule: RestaurantListModule {selectedRestaurants: Set(0), ...}
window.uiManager: UIManager {...}
uiManager.restaurantListModule: RestaurantListModule {...}
```

### 2. Check Selection Properties
```javascript
// Check if selection properties exist
console.log('selectedRestaurants:', window.restaurantListModule?.selectedRestaurants);
console.log('selectionMode:', window.restaurantListModule?.selectionMode);
```

**Expected Output:**
```
selectedRestaurants: Set(0) {}
selectionMode: false
```

### 3. Check Methods Exist
```javascript
// Check if new methods are defined
console.log('toggleSelection:', typeof window.restaurantListModule?.toggleSelection);
console.log('exportSelected:', typeof window.restaurantListModule?.exportSelected);
console.log('deleteSelected:', typeof window.restaurantListModule?.deleteSelected);
console.log('clearSelection:', typeof window.restaurantListModule?.clearSelection);
```

**Expected Output:**
```
toggleSelection: function
exportSelected: function
deleteSelected: function
clearSelection: function
```

### 4. Check Checkbox in DOM
```javascript
// Check if checkboxes are rendered
const checkboxes = document.querySelectorAll('.restaurant-checkbox');
console.log('Checkboxes found:', checkboxes.length);
console.log('First checkbox:', checkboxes[0]);
```

### 5. Manual Test Selection
```javascript
// Try to manually select a restaurant (replace 1 with actual restaurant ID)
const restaurantId = 1;
window.restaurantListModule.toggleSelection(restaurantId);
console.log('After toggle:', window.restaurantListModule.selectedRestaurants);
```

### 6. Check Bulk Action Toolbar
```javascript
// Check if toolbar exists (will be created when first item is selected)
const toolbar = document.getElementById('bulk-action-toolbar');
console.log('Bulk action toolbar:', toolbar);
```

## Common Issues and Fixes

### Issue: `window.restaurantListModule` is undefined

**Possible Causes:**
1. **Browser cache** - Hard refresh: `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows)
2. **Script load order** - Check browser console for script loading errors
3. **Module not initialized** - Check if `window.uiManager` exists first

**Fix:**
```javascript
// Force re-initialization if needed
if (window.uiManager && !window.restaurantListModule) {
    window.restaurantListModule = new RestaurantListModule();
    window.restaurantListModule.init({
        dataStorage: window.dataStorage,
        uiUtils: window.uiUtils
    });
    console.log('Manually initialized RestaurantListModule');
}
```

### Issue: Checkboxes not appearing

**Check:**
```javascript
// Verify the card HTML includes checkbox
const cards = document.querySelectorAll('.restaurant-card');
console.log('Restaurant cards:', cards.length);
if (cards.length > 0) {
    console.log('First card HTML:', cards[0].innerHTML.substring(0, 500));
}
```

**Look for:** `<input type="checkbox" class="restaurant-checkbox"`

### Issue: Clicking checkbox does nothing

**Check event listener:**
```javascript
const checkbox = document.querySelector('.restaurant-checkbox');
if (checkbox) {
    // Check if data attribute exists
    console.log('Checkbox restaurant ID:', checkbox.dataset.restaurantId);
    
    // Manually trigger
    checkbox.checked = !checkbox.checked;
    const event = new Event('change', { bubbles: true });
    checkbox.dispatchEvent(event);
}
```

## File Verification Commands

Run these in terminal to verify files contain the changes:

```bash
# Check RestaurantListModule has selection code
grep -n "selectedRestaurants" scripts/modules/restaurantListModule.js

# Check checkbox in renderRestaurantCard
grep -n "restaurant-checkbox" scripts/modules/restaurantListModule.js

# Check UIManager initializes the module
grep -n "restaurantListModule" scripts/uiManager.js

# Check transformToV2Format exists
grep -n "transformToV2Format" scripts/dataStorage.js
```

## Nuclear Option: Clear All Cache

If nothing works:

1. Open DevTools (`Cmd + Option + I`)
2. Go to Application tab
3. Click "Clear storage" in left sidebar
4. Check all boxes
5. Click "Clear site data"
6. Hard refresh the page
7. Re-enter password if needed

## Verify Changes Were Applied

Check file modification times:
```bash
stat -f "%Sm %N" scripts/modules/restaurantListModule.js
stat -f "%Sm %N" scripts/dataStorage.js
stat -f "%Sm %N" scripts/uiManager.js
```

All three files should have today's date (October 17, 2025).
