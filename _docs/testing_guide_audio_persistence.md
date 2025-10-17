# Testing Guide: Audio Persistence and Draft Management

## Date: October 16, 2025

## Prerequisites

1. Open the application in a browser
2. Open Browser Developer Tools (F12)
3. Go to Application > IndexedDB > RestaurantCurator
4. Verify tables exist: `pendingAudio` and `draftRestaurants`

## Test Scenarios

### Scenario 1: Successful Recording and Transcription

**Steps**:
1. Select a curator
2. Click "Start Recording"
3. Speak for 5-10 seconds
4. Click "Stop Recording"
5. Wait for transcription to complete

**Expected Results**:
- ✅ Audio preview appears immediately
- ✅ Processing indicator shows
- ✅ Check IndexedDB `pendingAudio` table: new record with status="processing"
- ✅ Transcription appears in textarea
- ✅ Check IndexedDB `pendingAudio` table: status="completed"
- ✅ Pending badge does NOT appear (or count decreases if others pending)

**Validation**:
```javascript
// In console
const audios = await window.dataStorage.db.pendingAudio.toArray();
console.log('Pending audios:', audios);
// Should show completed audio
```

---

### Scenario 2: Failed Transcription with Auto-Retry

**Steps**:
1. Temporarily disable internet connection
2. Start and stop recording
3. Wait and observe

**Expected Results**:
- ✅ Audio saves to IndexedDB
- ✅ First transcription fails
- ✅ Notification: "Transcription failed. Retrying automatically (attempt 1 of 2)..."
- ✅ Wait 5 seconds → automatic retry #1
- ✅ Retry fails
- ✅ Notification: "Transcription failed. Retrying automatically (attempt 2 of 2)..."
- ✅ Wait 15 seconds → automatic retry #2
- ✅ Retry fails
- ✅ Manual retry UI appears with warning message
- ✅ Check IndexedDB: status="failed", retryCount=2

**Validation**:
```javascript
// Check retry count
const failedAudio = await window.dataStorage.db.pendingAudio
    .where('status').equals('failed')
    .first();
console.log('Retry count:', failedAudio?.retryCount); // Should be 2
```

---

### Scenario 3: Manual Retry After Failure

**Steps**:
1. Continue from Scenario 2 (manual retry UI visible)
2. Re-enable internet connection
3. Click "Retry Transcription" button

**Expected Results**:
- ✅ Button shows "Retrying..." with spinning icon
- ✅ Button disabled during retry
- ✅ Transcription succeeds
- ✅ Transcription appears in textarea
- ✅ Manual retry UI disappears
- ✅ Check IndexedDB: status="completed", retryCount=0 (reset)

---

### Scenario 4: Delete Failed Audio

**Steps**:
1. Create a failed audio (disconnect internet, record, wait for retries)
2. Click "Delete Audio" button
3. Confirm deletion

**Expected Results**:
- ✅ Confirmation dialog appears
- ✅ Audio removed from IndexedDB
- ✅ Manual retry UI disappears
- ✅ Notification: "Audio recording deleted"

**Validation**:
```javascript
// Check audio is gone
const audios = await window.dataStorage.db.pendingAudio.toArray();
console.log('Remaining audios:', audios.length);
```

---

### Scenario 5: Draft Auto-Save (New Restaurant)

**Steps**:
1. Select a curator
2. Type restaurant name: "Test Restaurant"
3. Wait 3+ seconds (don't type anything)
4. Open IndexedDB `draftRestaurants` table

**Expected Results**:
- ✅ After 3 seconds, draft saved automatically
- ✅ Check console: "Draft auto-saved"
- ✅ IndexedDB shows draft with name="Test Restaurant"
- ✅ `lastModified` timestamp is recent

**Validation**:
```javascript
// Check draft
const drafts = await window.dataStorage.db.draftRestaurants.toArray();
console.log('Current drafts:', drafts);
// Should show draft with your restaurant name
```

---

### Scenario 6: Draft Auto-Save with Multiple Fields

**Steps**:
1. Type restaurant name: "Amazing Bistro"
2. Wait 3 seconds
3. Type transcription: "This place has great food"
4. Wait 3 seconds
5. Add a concept (e.g., "French" in Cuisine)
6. Wait 3 seconds
7. Get location
8. Wait 3 seconds

**Expected Results**:
- ✅ Each change triggers auto-save after 3 seconds
- ✅ Console shows "Draft auto-saved" multiple times
- ✅ IndexedDB draft updates with each field
- ✅ `lastModified` timestamp updates each time

**Validation**:
```javascript
// Check draft data
const draft = await window.DraftRestaurantManager.getDraft(
    window.DraftRestaurantManager.currentDraftId
);
console.log('Draft data:', draft);
// Should show name, transcription, concepts, location
```

---

### Scenario 7: Draft Persistence Across Reload

**Steps**:
1. Create a draft with multiple fields (name, transcription, concepts)
2. Note the draft ID from console
3. Reload the page (F5)
4. Check IndexedDB `draftRestaurants` table

**Expected Results**:
- ✅ Draft persists after reload
- ✅ Draft data intact in IndexedDB
- ✅ DraftRestaurantManager can retrieve draft

**Validation**:
```javascript
// After reload, check if draft exists
const drafts = await window.dataStorage.db.draftRestaurants.toArray();
console.log('Drafts after reload:', drafts);
// Should show same draft with same data
```

---

### Scenario 8: Restaurant Save Cleanup

**Steps**:
1. Create a draft with name and transcription
2. Record audio (let it transcribe successfully)
3. Add a concept
4. Click "Save Restaurant"
5. Check IndexedDB tables

**Expected Results**:
- ✅ Restaurant saves successfully
- ✅ Notification: "Restaurant saved successfully"
- ✅ Check `pendingAudio` table: audio record DELETED
- ✅ Check `draftRestaurants` table: draft DELETED
- ✅ Pending badge disappears (if it was showing)
- ✅ Console: "Pending audio cleaned up after restaurant save"
- ✅ Console: "Draft restaurant cleaned up after save"

**Validation**:
```javascript
// Check cleanup
const audios = await window.dataStorage.db.pendingAudio.toArray();
const drafts = await window.dataStorage.db.draftRestaurants.toArray();
console.log('Audios after save:', audios.length); // Should be 0 or decreased
console.log('Drafts after save:', drafts.length); // Should be 0 or decreased
```

---

### Scenario 9: Pending Audio Badge

**Steps**:
1. Create 2-3 failed recordings (disconnect internet, record, wait for retries)
2. Look at recording section header

**Expected Results**:
- ✅ Badge appears on "Record Your Restaurant Review" header
- ✅ Badge shows correct count (e.g., "3 pending")
- ✅ Badge is yellow with white text
- ✅ Badge shows pointer cursor on hover
- ✅ Click badge shows alert (TODO: full modal)

**Validation**:
```javascript
// Check badge element
const badge = document.getElementById('pending-audio-badge');
console.log('Badge text:', badge?.textContent); // Should show count
```

---

### Scenario 10: Edit Existing Restaurant (No Auto-Save)

**Steps**:
1. Save a restaurant successfully
2. Edit that restaurant from the list
3. Modify the name
4. Wait 3+ seconds
5. Check IndexedDB `draftRestaurants`

**Expected Results**:
- ✅ Name changes in UI
- ✅ Auto-save does NOT trigger (we're editing saved restaurant)
- ✅ No new draft created in IndexedDB
- ✅ No console message "Draft auto-saved"

**Rationale**: Auto-save should only work for NEW restaurants, not existing ones.

---

### Scenario 11: Multiple Curators with Separate Drafts

**Steps**:
1. Create Curator A, add draft "Restaurant A"
2. Switch to Curator B, add draft "Restaurant B"
3. Check IndexedDB `draftRestaurants`
4. Switch back to Curator A

**Expected Results**:
- ✅ Two separate drafts in IndexedDB
- ✅ Each draft has correct `curatorId`
- ✅ When switching curators, correct draft is active
- ✅ `currentDraftId` updates when switching

**Validation**:
```javascript
// Check drafts per curator
const drafts = await window.dataStorage.db.draftRestaurants.toArray();
console.log('Drafts by curator:', drafts.map(d => ({ 
    curatorId: d.curatorId, 
    name: d.name 
})));
```

---

### Scenario 12: Additional Recording (Existing Restaurant)

**Steps**:
1. Edit an existing restaurant
2. Click "Record Additional Review"
3. Record audio and wait for transcription
4. Save restaurant

**Expected Results**:
- ✅ Audio saves with `isAdditional: true`
- ✅ Transcription appends to existing text
- ✅ Audio cleaned up after save
- ✅ No draft created (editing existing restaurant)

---

## Edge Cases to Test

### Edge Case 1: Empty Draft Prevention
**Test**: Create draft with only spaces/empty fields
**Expected**: Draft not saved (no meaningful data)

### Edge Case 2: Rapid Field Changes
**Test**: Type quickly in multiple fields without waiting
**Expected**: Only one auto-save triggered (debounced)

### Edge Case 3: Audio Blob Size
**Test**: Record very long audio (8-10 minutes)
**Expected**: Audio saves successfully, size logged

### Edge Case 4: Concurrent Recordings
**Test**: Try to record while another recording is processing
**Expected**: Previous recording completes first or error handled

### Edge Case 5: Offline Recording
**Test**: Record while completely offline
**Expected**: Audio saves, retries scheduled for when online

---

## Performance Tests

### Performance 1: Auto-Save Impact
**Measure**: Time between keystrokes with auto-save active
**Expected**: No noticeable lag (<50ms)

### Performance 2: Audio Save Time
**Measure**: Time to save audio blob to IndexedDB
**Expected**: <100ms for typical recording

### Performance 3: Badge Update Time
**Measure**: Time to update pending audio badge
**Expected**: <50ms

### Performance 4: Draft Load Time
**Measure**: Time to load draft on page load
**Expected**: <200ms

---

## Cleanup Tests

### Cleanup 1: Old Completed Audios
**Test**: 
```javascript
// Manually set old timestamp
const audio = await window.dataStorage.db.pendingAudio.first();
await window.dataStorage.db.pendingAudio.update(audio.id, {
    timestamp: new Date('2025-10-01'),
    status: 'completed'
});

// Run cleanup
const deleted = await window.PendingAudioManager.cleanupOldAudios(7);
console.log('Deleted:', deleted); // Should be 1
```

### Cleanup 2: Old Empty Drafts
**Test**:
```javascript
// Create old empty draft
await window.dataStorage.db.draftRestaurants.add({
    curatorId: 1,
    name: '',
    timestamp: new Date('2025-09-01'),
    lastModified: new Date('2025-09-01'),
    hasAudio: false,
    transcription: '',
    description: '',
    metadata: '{}'
});

// Run cleanup
const deleted = await window.DraftRestaurantManager.cleanupOldDrafts(30);
console.log('Deleted:', deleted); // Should be 1
```

---

## Console Commands for Testing

```javascript
// View all pending audios
window.dataStorage.db.pendingAudio.toArray().then(console.log);

// View all drafts
window.dataStorage.db.draftRestaurants.toArray().then(console.log);

// Get audio counts
window.PendingAudioManager.getAudioCounts().then(console.log);

// Get current draft
window.DraftRestaurantManager.getDraft(
    window.DraftRestaurantManager.currentDraftId
).then(console.log);

// Force auto-save
window.uiManager.conceptModule.autoSaveDraft();

// Force badge update
window.uiManager.recordingModule.showPendingAudioBadge();

// Clear all pending audios (DESTRUCTIVE)
window.dataStorage.db.pendingAudio.clear();

// Clear all drafts (DESTRUCTIVE)
window.dataStorage.db.draftRestaurants.clear();

// Simulate transcription failure
// (Temporarily disconnect internet before recording)
```

---

## Known Issues / Limitations

1. **Badge Click**: Currently shows alert, needs full modal implementation
2. **Draft List**: No UI to view/manage all drafts yet
3. **Draft Recovery**: No prompt to restore draft on page load
4. **Progress Indicator**: No real-time transcription progress
5. **Audio Playback**: Cannot preview audio before retry/delete

---

## Success Criteria

All scenarios pass with expected results:
- [ ] Successful recording flow
- [ ] Failed transcription with auto-retry
- [ ] Manual retry after failure
- [ ] Delete failed audio
- [ ] Draft auto-save (single field)
- [ ] Draft auto-save (multiple fields)
- [ ] Draft persistence across reload
- [ ] Restaurant save cleanup
- [ ] Pending audio badge
- [ ] Edit restaurant (no auto-save)
- [ ] Multiple curators
- [ ] Additional recording
- [ ] All edge cases handled
- [ ] Performance acceptable
- [ ] Cleanup functions work

---

## Reporting Issues

When reporting issues, include:
1. Browser name and version
2. Console logs (errors)
3. IndexedDB state (screenshot)
4. Steps to reproduce
5. Expected vs actual behavior
6. Network state (online/offline)
