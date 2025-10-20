# Quick Fix Guide - Michelin Import Not Syncing

## What Was Fixed

Your Michelin restaurants weren't uploading because the import code didn't mark them for sync (`needsSync=true`).

## Files Changed

1. **scripts/dataStorage.js** - Import now sets `needsSync=true` for new restaurants
2. **scripts/syncManager.js** - Auto-repair fixes already-imported restaurants

## How to Test

### Step 1: Refresh the App

Just refresh your browser. The integrity check runs automatically after 2 seconds.

### Step 2: Check Console

Look for this message in the browser console:
```
✅ Data integrity check complete: Fixed X inconsistent state(s)
```

If you see this, your already-imported restaurants are now fixed.

### Step 3: Click "Sync Data"

The button at the bottom of the sidebar should now work. Watch the console for:
```
🔄 Manual sync triggered from sidebar
[ConciergeSync] Found X pending restaurants
✅ Comprehensive sync complete
```

### Step 4: Verify Upload

Check if your restaurants now have server IDs:
```javascript
// Paste in console
dataStorage.db.restaurants
  .filter(r => r.name.includes('Michelin'))
  .toArray()
  .then(restaurants => {
    console.table(restaurants.map(r => ({
      name: r.name,
      serverId: r.serverId,
      needsSync: r.needsSync
    })));
  });
```

After sync, `serverId` should be a number and `needsSync` should be `false`.

## What If It Doesn't Work?

### Check 1: Are Restaurants Marked for Sync?

```javascript
// Count pending restaurants
dataStorage.db.restaurants
  .where('needsSync').equals(true)
  .count()
  .then(count => console.log(`Pending: ${count}`));
```

If count is 0 but you see restaurants without serverIds, the integrity check didn't run. Try refreshing again.

### Check 2: Is Sync Manager Available?

```javascript
// Check if sync manager is loaded
console.log('SyncManager:', window.syncManager ? 'Available ✅' : 'Missing ❌');
```

### Check 3: Manual Sync via Console

If button doesn't work, try manual sync:
```javascript
// Run sync manually
window.syncManager.performComprehensiveSync(true)
  .then(() => console.log('✅ Sync complete'))
  .catch(err => console.error('❌ Sync error:', err));
```

## Expected Results

**Before Fix:**
- Import: ✅ Restaurants appear locally
- Sync Status: ❌ `needsSync=false`, not in queue
- Sync Button: ❌ Nothing happens (no pending restaurants)
- Server: ❌ No upload

**After Fix:**
- Import: ✅ Restaurants appear with `needsSync=true`
- Sync Status: ✅ Shows in pending count
- Sync Button: ✅ Uploads to server
- Server: ✅ Returns `serverId`, marks as synced

## New Imports

For any NEW Michelin JSON files you import from now on:
- ✅ Auto-marked for sync immediately
- ✅ No need to refresh or wait
- ✅ Just click "Sync Data" and it works

## Debug Commands

### See All Restaurants State
```javascript
dataStorage.db.restaurants.toArray().then(restaurants => {
  console.table(restaurants.map(r => ({
    name: r.name.substring(0, 30),
    source: r.source,
    serverId: r.serverId,
    needsSync: r.needsSync
  })));
});
```

### See Only Pending Sync
```javascript
dataStorage.db.restaurants
  .where('needsSync').equals(true)
  .toArray()
  .then(restaurants => {
    console.log(`Found ${restaurants.length} pending restaurants:`);
    console.table(restaurants.map(r => ({
      name: r.name,
      source: r.source,
      serverId: r.serverId
    })));
  });
```

### Force Integrity Check
```javascript
// Run integrity check manually
window.syncManager.checkDataIntegrity();
```

---

**TL;DR:** 
1. Refresh the app
2. Wait 2 seconds
3. Click "Sync Data"
4. Your Michelin restaurants should upload ✅
