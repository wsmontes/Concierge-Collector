# Testing Checklist: Unified Sync Button

## Pre-Test Setup
- [ ] Clear browser cache (Cmd+Shift+R)
- [ ] Open DevTools Console (Cmd+Option+J)
- [ ] Open DevTools Network tab
- [ ] Ensure you're logged in as a curator
- [ ] Have at least one restaurant in local database

---

## 1. Visual Verification

### Button Appearance
- [ ] Button displays with sync icon (🔄)
- [ ] Button text reads "Sync with Server"
- [ ] Helper text below: "Imports from and exports to remote server"
- [ ] Button has blue background (bg-blue-500)
- [ ] Button has shadow effect
- [ ] Old import/export buttons are NOT visible

### Button Interactions
- [ ] Hover changes background to darker blue
- [ ] Cursor shows pointer on hover
- [ ] Button has smooth transition effects

---

## 2. Functional Testing

### Basic Sync (Happy Path)
1. [ ] Click "Sync with Server" button
2. [ ] Button becomes disabled
3. [ ] Icon starts spinning
4. [ ] Button opacity reduces (appears dimmed)
5. [ ] Cursor changes to "not-allowed"
6. [ ] Loading overlay appears
7. [ ] Loading message shows "🔄 Syncing with server..."
8. [ ] Message updates to "📥 Importing from server (1/2)..."
9. [ ] Console logs show import progress
10. [ ] Message updates to "📤 Exporting to server (2/2)..."
11. [ ] Console logs show export progress
12. [ ] Loading overlay disappears
13. [ ] Success notification appears: "✅ Sync completed successfully in X.XXs"
14. [ ] Button becomes enabled again
15. [ ] Icon stops spinning
16. [ ] Restaurant list refreshes

### Console Output Check
Expected console logs:
```
🔄 Starting unified sync with server...
🔄 Step 1/2: Importing from server...
Starting remote data import operation...
Remote import: Sending GET request to...
[import logs...]
✅ Import completed successfully
🔄 Step 2/2: Exporting to server...
Starting remote data export operation...
[export logs...]
✅ Export completed successfully
✅ Unified sync completed in X.XXs
```

- [ ] All expected logs appear
- [ ] No error logs (unless testing error scenarios)
- [ ] Timing information included

---

## 3. Error Scenarios

### Import Failure
**Setup:** Disconnect network after clicking sync, before import completes

1. [ ] Click sync button
2. [ ] Wait for import to start
3. [ ] Disconnect network (or block API in DevTools)
4. [ ] Import fails with network error
5. [ ] Warning notification appears
6. [ ] Message: "Import failed: [error]. Continuing with export..."
7. [ ] Sync continues to export step
8. [ ] Export attempts (and fails if still offline)
9. [ ] Button re-enables after completion

### Export Failure
**Setup:** Disconnect network after import completes, before export starts

1. [ ] Click sync button
2. [ ] Import completes successfully
3. [ ] Disconnect network before export
4. [ ] Export fails with network error
5. [ ] Error notification appears
6. [ ] Message: "Sync failed: [error]"
7. [ ] Button re-enables

### Both Fail
**Setup:** No network connection from start

1. [ ] Disconnect network
2. [ ] Click sync button
3. [ ] Import fails
4. [ ] Warning notification shows
5. [ ] Export fails
6. [ ] Error notification shows final failure
7. [ ] Button re-enables
8. [ ] Can retry when network restored

### Server Error (500)
**Setup:** Simulate server error in DevTools

1. [ ] Mock 500 response in Network tab
2. [ ] Click sync button
3. [ ] Appropriate error message shown
4. [ ] User notified of server issue
5. [ ] Button re-enables for retry

---

## 4. Edge Cases

### Rapid Clicking
1. [ ] Click sync button rapidly (5+ times)
2. [ ] Only one sync operation runs
3. [ ] Button stays disabled during sync
4. [ ] Subsequent clicks are ignored
5. [ ] Button re-enables after completion

### Page Reload During Sync
1. [ ] Click sync button
2. [ ] Reload page during sync (Cmd+R)
3. [ ] Page reloads cleanly
4. [ ] No hanging state
5. [ ] Button is enabled on new page load

### Empty Database
1. [ ] Clear all restaurants from database
2. [ ] Click sync button
3. [ ] Import works (gets restaurants from server)
4. [ ] Export handles empty data gracefully
5. [ ] Success notification shows

### Large Dataset
1. [ ] Have 100+ restaurants in database
2. [ ] Click sync button
3. [ ] Watch performance
4. [ ] Sync completes without timeout
5. [ ] Loading messages update appropriately
6. [ ] Performance metrics logged

---

## 5. Performance Testing

### Timing Verification
1. [ ] Record start time
2. [ ] Click sync button
3. [ ] Note import duration in console
4. [ ] Note export duration in console
5. [ ] Note total duration in notification
6. [ ] Total = Import + Export + overhead (~500ms)
7. [ ] Timing is accurate (±100ms)

### Network Monitoring
Open Network tab and verify:
1. [ ] GET request to `/api/restaurants` (import)
2. [ ] POST request to `/api/restaurants` (export)
3. [ ] No duplicate requests
4. [ ] Proper request/response headers
5. [ ] Reasonable payload sizes
6. [ ] Response times logged

---

## 6. Responsive Testing

### Mobile Viewport (375px)
1. [ ] Resize browser to mobile size
2. [ ] Button displays correctly
3. [ ] Text doesn't overflow
4. [ ] Touch target is large enough (44px min)
5. [ ] Loading overlay fits screen

### Tablet Viewport (768px)
1. [ ] Resize browser to tablet size
2. [ ] Button displays correctly
3. [ ] Layout is balanced

### Desktop Viewport (1920px)
1. [ ] Full screen displays correctly
2. [ ] Button doesn't stretch too wide
3. [ ] Proper alignment maintained

---

## 7. Accessibility Testing

### Keyboard Navigation
1. [ ] Tab to sync button
2. [ ] Focus ring is visible
3. [ ] Press Enter to activate
4. [ ] Button behavior same as mouse click
5. [ ] Tab away while syncing (button stays disabled)

### Screen Reader (VoiceOver on Mac)
1. [ ] Enable VoiceOver (Cmd+F5)
2. [ ] Navigate to sync button
3. [ ] Button announces: "Sync with Server, button"
4. [ ] Disabled state announces properly
5. [ ] Helper text is read

### Color Contrast
1. [ ] Button text passes WCAG AA (4.5:1)
2. [ ] Icon is visible
3. [ ] Disabled state is clear but not too faint

---

## 8. Integration Testing

### With Restaurant List
1. [ ] Add restaurant locally
2. [ ] Click sync
3. [ ] Verify restaurant appears on server
4. [ ] Verify restaurant list updates

### With Curator System
1. [ ] Switch curator
2. [ ] Click sync
3. [ ] Correct curator's data syncs
4. [ ] Filter checkbox works

### With Other Features
1. [ ] Sync during restaurant edit
2. [ ] Sync with modal open
3. [ ] Sync with notifications active
4. [ ] No conflicts or issues

---

## 9. Verification Script

Run automated verification:
```javascript
// Copy and paste this into console
const script = document.createElement('script');
script.src = '_docs/verify_sync_button.js';
document.head.appendChild(script);
```

Expected output:
- [ ] ✅ Sync button exists
- [ ] ✅ Old buttons removed
- [ ] ✅ Correct icon and text
- [ ] ✅ Method exists on module
- [ ] ✅ Proper styling applied

---

## 10. Production Readiness

### Code Quality
- [ ] No console errors
- [ ] No TypeScript/lint errors
- [ ] Code follows project standards
- [ ] All dependencies available

### Documentation
- [ ] Implementation guide exists
- [ ] Quick reference created
- [ ] Visual flow diagram available
- [ ] Inline code comments present

### Rollback Plan
- [ ] Can easily revert to old buttons if needed
- [ ] Old methods still exist (backward compatible)
- [ ] Database changes are reversible
- [ ] Users can still sync via alternative methods

---

## Test Results Summary

**Tested by:** ___________________  
**Date:** ___________________  
**Browser:** ___________________  
**Version:** ___________________  

### Overall Status
- [ ] ✅ All tests passed
- [ ] ⚠️ Minor issues found (document below)
- [ ] ❌ Major issues found (do not deploy)

### Issues Found
```
Issue #1:
Description:
Severity: [ ] High [ ] Medium [ ] Low
Status: [ ] Fixed [ ] Pending [ ] Accepted

Issue #2:
Description:
Severity: [ ] High [ ] Medium [ ] Low
Status: [ ] Fixed [ ] Pending [ ] Accepted
```

### Approval
- [ ] Ready for production deployment
- [ ] Requires additional testing
- [ ] Requires bug fixes

**Signature:** ___________________

---

## Quick Test (30 seconds)

Minimal test for quick verification:

1. ✅ Old buttons gone, new button present
2. ✅ Click button → icon spins
3. ✅ Console shows import/export logs
4. ✅ Success notification appears
5. ✅ Button re-enables

If all 5 pass: ✅ Basic functionality works

---

## Notes

Add any observations, performance metrics, or issues here:

```
[Your notes]
```
