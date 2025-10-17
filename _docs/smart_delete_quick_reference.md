# Smart Delete Quick Reference

## 🎯 What Was Implemented

### Database Schema Update (Version 8)
Added two new fields to restaurants table:
- `deletedLocally` (boolean) - Marks restaurants hidden by user
- `deletedAt` (Date) - Timestamp of when it was deleted

### New Functions in dataStorage.js

1. **`smartDeleteRestaurant(restaurantId, options)`**
   - Automatically determines delete strategy
   - Local restaurants → Permanent delete
   - Synced restaurants → Soft delete (archive)
   - Returns: `{ type: 'soft'|'permanent', id, name }`

2. **`softDeleteRestaurant(restaurantId)`**
   - Sets `deletedLocally: true` and `deletedAt: now()`
   - Keeps restaurant in database
   - Hides from UI

3. **`restoreRestaurant(restaurantId)`**
   - Clears `deletedLocally` and `deletedAt`
   - Makes restaurant visible again

### Updated Filtering
- `getRestaurants()` now has `includeDeleted` option (default: false)
- Soft-deleted restaurants are automatically hidden from all lists

---

## 📋 How It Works

### Delete Flow

```
User clicks DELETE
    ↓
Check restaurant.serverId and restaurant.source
    ↓
┌─────────────────────────────────┬─────────────────────────────────┐
│ LOCAL RESTAURANT                │ SYNCED RESTAURANT               │
│ (source='local' OR no serverId) │ (source='remote' + serverId)    │
├─────────────────────────────────┼─────────────────────────────────┤
│ Confirmation:                   │ Confirmation:                   │
│ "Permanently delete?"           │ "Archive recommended?"          │
│ "Cannot be undone"              │ "Would re-appear on sync"       │
├─────────────────────────────────┼─────────────────────────────────┤
│ Action: PERMANENT DELETE        │ Action: SOFT DELETE (Archive)   │
│ - Remove from database          │ - Set deletedLocally = true     │
│ - Delete all related data       │ - Set deletedAt = now()         │
│                                 │ - Keep in database              │
├─────────────────────────────────┼─────────────────────────────────┤
│ Notification:                   │ Notification:                   │
│ "Deleted permanently"           │ "Archived (hidden from list)"   │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## 🧪 Testing Guide

### Test 1: Delete Local Restaurant

1. Create a new restaurant (don't sync)
2. Click delete button
3. **Expected confirmation:**
   ```
   Are you sure you want to delete "[Name]"?
   
   This local restaurant will be permanently deleted.
   This action cannot be undone.
   ```
4. Click OK
5. **Expected:** Restaurant disappears and shows "deleted permanently"
6. Reload page → Restaurant should NOT reappear

### Test 2: Delete Synced Restaurant

1. Sync with server to get remote restaurants
2. Find a synced restaurant (shows in list)
3. Click delete button
4. **Expected confirmation:**
   ```
   "[Name]" was synced from the server.
   
   ⚠️ ARCHIVE (Recommended):
   This will hide the restaurant locally but keep it for sync.
   It won't appear in your list.
   
   Note: Permanent deletion would cause it to re-appear on next sync.
   
   Archive this restaurant?
   ```
5. Click OK
6. **Expected:** Restaurant disappears and shows "archived"
7. **Check database:**
   ```javascript
   const r = await dataStorage.db.restaurants.get([id]);
   console.log(r.deletedLocally); // Should be true
   console.log(r.deletedAt);      // Should be a date
   ```
8. Reload page → Restaurant should NOT reappear
9. Sync again → Restaurant should stay hidden

### Test 3: View Archived Restaurants

```javascript
// In browser console:
const deleted = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .toArray();
    
console.log(`Found ${deleted.length} archived restaurants:`);
deleted.forEach(r => {
    console.log(`- ${r.name} (archived ${r.deletedAt})`);
});
```

### Test 4: Restore Archived Restaurant

```javascript
// In browser console:
// Find ID of archived restaurant first
const deleted = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .toArray();
    
if (deleted.length > 0) {
    const restaurantId = deleted[0].id;
    const result = await dataStorage.restoreRestaurant(restaurantId);
    console.log('Restored:', result);
    
    // Reload the restaurant list to see it again
    window.location.reload();
}
```

---

## 🔍 Database Inspection Commands

### View All Restaurants (Including Deleted)
```javascript
const all = await dataStorage.db.restaurants.toArray();
console.log(`Total: ${all.length}`);

const active = all.filter(r => !r.deletedLocally);
const archived = all.filter(r => r.deletedLocally);

console.log(`Active: ${active.length}`);
console.log(`Archived: ${archived.length}`);
```

### Check Specific Restaurant
```javascript
const r = await dataStorage.db.restaurants.get(123); // Replace 123 with ID
console.log('Name:', r.name);
console.log('Source:', r.source);
console.log('Server ID:', r.serverId);
console.log('Deleted Locally:', r.deletedLocally);
console.log('Deleted At:', r.deletedAt);
```

### List Archived Restaurants
```javascript
const archived = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .sortBy('deletedAt');
    
console.table(archived.map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    serverId: r.serverId,
    deletedAt: r.deletedAt
})));
```

### Restore All Archived
```javascript
const archived = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .toArray();
    
for (const r of archived) {
    await dataStorage.restoreRestaurant(r.id);
    console.log(`Restored: ${r.name}`);
}

console.log(`Restored ${archived.length} restaurants`);
window.location.reload();
```

### Permanently Delete Archived
```javascript
// WARNING: This will permanently delete archived restaurants!
const archived = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .toArray();
    
for (const r of archived) {
    await dataStorage.deleteRestaurant(r.id);
    console.log(`Permanently deleted: ${r.name}`);
}

console.log(`Deleted ${archived.length} restaurants permanently`);
```

---

## ⚙️ Advanced Options

### Force Permanent Delete of Synced Restaurant
```javascript
// This will permanently delete even synced restaurants
// WARNING: They will re-appear on next sync!
await dataStorage.smartDeleteRestaurant(restaurantId, { force: true });
```

### Include Deleted in Queries
```javascript
// Get restaurants including soft-deleted ones
const all = await dataStorage.getRestaurants({
    curatorId: 1,
    includeDeleted: true  // ← Show archived
});
```

---

## 🐛 Troubleshooting

### Problem: Deleted restaurant reappears after reload
**Diagnosis:** Check if it was permanently deleted or soft-deleted
```javascript
const r = await dataStorage.db.restaurants.get([id]);
if (r) {
    console.log('Still in database:', r.deletedLocally ? 'ARCHIVED' : 'ACTIVE');
} else {
    console.log('Not in database - was permanently deleted');
}
```

### Problem: Can't delete restaurant
**Check:**
1. Is there an error in console?
2. What's the restaurant's source?
   ```javascript
   const r = await dataStorage.db.restaurants.get([id]);
   console.log('Source:', r.source, 'ServerID:', r.serverId);
   ```

### Problem: Synced restaurant deleted but came back
**Expected behavior!** 
- If you PERMANENTLY delete a synced restaurant, it will re-import on next sync
- Use ARCHIVE instead (soft delete) to keep it hidden

---

## 📊 Migration Status

### Database Version: 7 → 8

**What's Added:**
- `deletedLocally` field (boolean, default: false)
- `deletedAt` field (Date, default: null)

**Migration Process:**
- Automatic on page reload
- Adds fields to all existing restaurants
- Sets default values (not deleted)

**Check Migration Status:**
```javascript
// Check if migration completed
const sample = await dataStorage.db.restaurants.limit(1).toArray();
if (sample.length > 0) {
    const hasNewFields = 'deletedLocally' in sample[0];
    console.log('Migration completed:', hasNewFields);
    console.log('Sample restaurant:', sample[0]);
}
```

---

## 🎨 UI Changes

### Confirmation Dialogs
- **Local restaurants:** Simple confirmation with warning
- **Synced restaurants:** Detailed explanation with recommendation

### Notification Messages
- **Permanent delete:** "Deleted permanently" (success notification)
- **Soft delete:** "Archived (hidden from list)" (info notification, 5s duration)

### Visual Indicators
- Soft-deleted restaurants: Hidden from all lists
- No special icon needed (completely hidden)

---

## 🔮 Future Enhancements

### 1. Restore UI (Not Implemented)
Add a "View Archived" button in settings to show and restore deleted restaurants

### 2. Auto-cleanup (Not Implemented)
Automatically permanently delete archived restaurants older than X days

### 3. Server Integration (Not Implemented)
If server API adds DELETE endpoint, update to sync deletions to server

### 4. Bulk Operations (Not Implemented)
Delete multiple restaurants at once with smart strategy

---

## 📝 Code Locations

- **Database Schema:** `/scripts/dataStorage.js` lines 24-48
- **Smart Delete Logic:** `/scripts/dataStorage.js` lines 1223-1323
- **Restaurant List Delete:** `/scripts/modules/restaurantListModule.js` lines 563-607
- **Restaurant Modal Delete:** `/scripts/modules/restaurantModule.js` lines 572-604
- **Filtering Logic:** `/scripts/dataStorage.js` lines 430-470

---

## ✅ Summary

**What Works:**
- ✅ Automatic detection of local vs synced restaurants
- ✅ Soft delete (archive) for synced restaurants
- ✅ Permanent delete for local restaurants
- ✅ Automatic hiding of soft-deleted restaurants
- ✅ Restore functionality via console
- ✅ Clear user communication

**What's Not Implemented:**
- ❌ UI for viewing archived restaurants
- ❌ UI for restoring archived restaurants
- ❌ Auto-cleanup of old archives
- ❌ Curator deletion (not addressed in this implementation)
- ❌ Server-side deletion sync

**Testing Status:**
- ⏳ Needs manual testing
- ⏳ Needs verification with real sync data
