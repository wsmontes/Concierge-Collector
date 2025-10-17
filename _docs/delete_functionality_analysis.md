# Delete Functionality Analysis & Smart Solution

**Date:** October 17, 2025  
**Issue:** Understanding delete behavior for local vs server-stored restaurants and curators

---

## Current State Analysis

### ✅ What EXISTS Currently

#### **Restaurant Deletion:**

1. **UI Buttons Present:**
   - Delete button in restaurant cards (restaurantListModule.js line 331)
   - Delete button in restaurant detail modal (restaurantModule.js line 541)

2. **Delete Functions Implemented:**
   - `dataStorage.deleteRestaurant(restaurantId)` - Lines 1209-1222
   - `restaurantListModule.deleteRestaurant(restaurantId)` - Lines 563-583
   - Restaurant modal delete handler - Lines 572-588

3. **What Gets Deleted:**
   ```javascript
   // dataStorage.deleteRestaurant() deletes:
   - restaurantConcepts (related concepts)
   - restaurantLocations (location data)
   - restaurantPhotos (photos)
   - restaurants (main record)
   ```

4. **Deletion Process:**
   - ✅ Shows confirmation dialog
   - ✅ Deletes from LOCAL database only
   - ❌ Does NOT notify server
   - ❌ Does NOT check if restaurant is local or remote
   - ❌ Does NOT prevent deletion of server-synced data

#### **Curator Deletion:**

1. **UI Buttons:** ❌ NO delete buttons for curators
2. **Delete Functions:** ❌ NO deleteCurator() function
3. **Only automated cleanup exists** (removing duplicates during sync)

---

## The Problem

### 🔴 **Critical Issues with Current Delete Implementation**

#### **Issue 1: Orphaned Server Data**
When you delete a restaurant that has a `serverId`:

```
LOCAL DATABASE               SERVER DATABASE
-----------------           ------------------
Restaurant deleted    ←     Restaurant still exists
serverId: 123                ID: 123
source: 'remote'             Name: "Ritz"
                             Status: Active ✅

RESULT: Data inconsistency - Next sync will re-import the deleted restaurant!
```

#### **Issue 2: Accidental Deletion of Synced Data**
```javascript
// Current code has NO protection:
async deleteRestaurant(restaurantId) {
    // No check if restaurant.source === 'remote'
    // No check if restaurant.serverId exists
    // Just deletes everything!
    await this.db.restaurants.delete(restaurantId);
}
```

**Scenario:**
1. User syncs from server → 87 restaurants imported with `serverId`
2. User accidentally clicks delete on "Ritz" (serverId: 1, source: 'remote')
3. Restaurant deleted from local database
4. Next sync: "Ritz" re-imported from server
5. **Result:** User thinks they deleted it, but it comes back!

#### **Issue 3: No Cascade Delete on Server**
There's no API endpoint to delete restaurants from the server:
- `apiHandler.js` has NO delete methods
- Server API (`https://wsmontes.pythonanywhere.com/api`) likely doesn't have DELETE endpoints
- Only GET operations are implemented

#### **Issue 4: Curator Deletion Impact**
If a curator could be deleted:
```
DELETE curator ID: 2
↓
What happens to restaurants with curatorId: 2?
- 6 restaurants become orphaned
- Foreign key constraint violated (if enforced)
- Or restaurants still reference deleted curator
```

---

## Smart Solution Architecture

### 🎯 **Three-Tier Delete Strategy**

```
┌─────────────────────────────────────────────────────┐
│         DELETION REQUEST RECEIVED                   │
└─────────────────────────────────────────────────────┘
                      ↓
        ┌─────────────────────────────┐
        │ Check: source & serverId    │
        └─────────────────────────────┘
                      ↓
        ┌─────────────┬─────────────┬─────────────┐
        ↓             ↓             ↓             ↓
    LOCAL         REMOTE        SYNCED      UNCERTAIN
  (safe delete) (soft delete) (archive)   (mark deleted)
```

### **Strategy 1: LOCAL-ONLY Restaurants** ✅ Safe to Delete
```javascript
Criteria:
- source === 'local' OR source === undefined
- serverId === null OR serverId === undefined

Action: PERMANENT DELETE
- Remove from database completely
- User created it locally, they own it
- No server sync implications
```

### **Strategy 2: REMOTE/SYNCED Restaurants** ⚠️ Soft Delete
```javascript
Criteria:
- source === 'remote'
- serverId !== null

Action: SOFT DELETE (Archive)
- Add 'deletedLocally: true' flag
- Add 'deletedAt: timestamp'
- Hide from UI
- Keep in database for sync reconciliation

Benefit:
- Data preserved for sync
- User can "restore" if accident
- Next sync can reconcile (if server has delete API)
```

### **Strategy 3: CURATORS** 🔒 Protected Delete
```javascript
Criteria:
- Check if curator has restaurants
- Check if curator.serverId exists

Action: CONDITIONAL DELETE
- If has restaurants → Prevent delete, show warning
- If serverId exists → Soft delete (hide, don't remove)
- If local-only AND no restaurants → Allow delete
```

---

## Implementation Plan

### Phase 1: Enhanced Restaurant Delete (IMMEDIATE)

**File:** `/scripts/dataStorage.js`

Add new field to restaurant schema:
```javascript
deletedLocally: boolean
deletedAt: Date (nullable)
```

**New Function:**
```javascript
async smartDeleteRestaurant(restaurantId, options = {}) {
    const restaurant = await this.db.restaurants.get(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');
    
    // Determine delete strategy
    const isLocal = !restaurant.serverId || 
                   !restaurant.source || 
                   restaurant.source === 'local';
    
    if (isLocal) {
        // STRATEGY 1: Permanent delete
        return await this.permanentDeleteRestaurant(restaurantId);
    } else {
        // STRATEGY 2: Soft delete (archive)
        if (options.force === true) {
            return await this.permanentDeleteRestaurant(restaurantId);
        }
        return await this.softDeleteRestaurant(restaurantId);
    }
}

async softDeleteRestaurant(restaurantId) {
    await this.db.restaurants.update(restaurantId, {
        deletedLocally: true,
        deletedAt: new Date()
    });
    return { type: 'soft', id: restaurantId };
}

async permanentDeleteRestaurant(restaurantId) {
    // Existing deleteRestaurant() logic
    await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
    await this.db.restaurantLocations.where('restaurantId').equals(restaurantId).delete();
    await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
    await this.db.restaurants.delete(restaurantId);
    return { type: 'permanent', id: restaurantId };
}
```

### Phase 2: Enhanced UI Feedback

**File:** `/scripts/modules/restaurantListModule.js`

```javascript
async deleteRestaurant(restaurantId) {
    try {
        const restaurant = await this.dataStorage.db.restaurants.get(restaurantId);
        if (!restaurant) {
            SafetyUtils.showNotification('Restaurant not found', 'error');
            return;
        }

        // Determine if this is a synced restaurant
        const isSynced = restaurant.serverId && restaurant.source === 'remote';
        
        let confirmMessage = `Are you sure you want to delete "${restaurant.name}"?`;
        
        if (isSynced) {
            confirmMessage = `
"${restaurant.name}" was synced from the server.

⚠️ Options:
• ARCHIVE: Hide locally but keep for next sync (RECOMMENDED)
• DELETE PERMANENTLY: Remove completely (will re-appear on next sync)

Choose ARCHIVE to hide this restaurant?
            `.trim();
        } else {
            confirmMessage += '\n\nThis local restaurant will be permanently deleted.';
        }

        const confirmed = confirm(confirmMessage);
        if (!confirmed) return;

        const result = await this.dataStorage.smartDeleteRestaurant(restaurantId);
        
        if (result.type === 'soft') {
            SafetyUtils.showNotification(
                `"${restaurant.name}" archived locally. It won't appear in your list.`, 
                'info'
            );
        } else {
            SafetyUtils.showNotification(
                `"${restaurant.name}" deleted permanently`, 
                'success'
            );
        }

        // Refresh the list
        await this.loadRestaurants();
        
    } catch (error) {
        console.error('Error deleting restaurant:', error);
        SafetyUtils.showNotification('Failed to delete restaurant', 'error');
    }
}
```

### Phase 3: Filter Soft-Deleted Restaurants

**File:** `/scripts/dataStorage.js`

Update `getRestaurants()` to filter out soft-deleted:

```javascript
async getRestaurants(options = {}) {
    // ... existing code ...
    
    let restaurants = await this.db.restaurants.toArray();
    
    // Filter out soft-deleted restaurants (unless explicitly requested)
    if (!options.includeDeleted) {
        restaurants = restaurants.filter(r => !r.deletedLocally);
    }
    
    // ... rest of existing code ...
}
```

### Phase 4: Restore Functionality (BONUS)

**New Feature:** Allow users to restore archived restaurants

```javascript
async restoreRestaurant(restaurantId) {
    await this.db.restaurants.update(restaurantId, {
        deletedLocally: false,
        deletedAt: null
    });
    return { restored: true, id: restaurantId };
}
```

**UI:** Add "View Archived" toggle in settings/restaurant list

---

## Curator Delete Strategy

### Phase 1: Prevent Dangerous Deletes

```javascript
async canDeleteCurator(curatorId) {
    // Check if curator has restaurants
    const restaurantCount = await this.db.restaurants
        .where('curatorId')
        .equals(curatorId)
        .count();
    
    if (restaurantCount > 0) {
        return {
            canDelete: false,
            reason: `Cannot delete curator with ${restaurantCount} restaurants`,
            restaurantCount
        };
    }
    
    // Check if synced from server
    const curator = await this.db.curators.get(curatorId);
    if (curator.serverId) {
        return {
            canDelete: false,
            reason: 'Cannot delete curator synced from server',
            suggestion: 'Archive instead of delete'
        };
    }
    
    return { canDelete: true };
}

async smartDeleteCurator(curatorId) {
    const check = await this.canDeleteCurator(curatorId);
    
    if (!check.canDelete) {
        throw new Error(check.reason);
    }
    
    // Safe to delete - no restaurants, local-only
    await this.db.curators.delete(curatorId);
    return { deleted: true, id: curatorId };
}
```

### Phase 2: UI Warning

```javascript
async deleteCurator(curatorId) {
    const check = await this.dataStorage.canDeleteCurator(curatorId);
    
    if (!check.canDelete) {
        alert(`❌ Cannot delete curator\n\n${check.reason}\n\n` +
              check.suggestion ? `Suggestion: ${check.suggestion}` : '');
        return;
    }
    
    const confirmed = confirm('Delete this curator? This action cannot be undone.');
    if (!confirmed) return;
    
    await this.dataStorage.smartDeleteCurator(curatorId);
    SafetyUtils.showNotification('Curator deleted', 'success');
    
    // Reload curator list
    await this.loadCurators();
}
```

---

## Database Schema Updates

### Add to version 8 migration:

```javascript
version(8).stores({
    // ... existing tables ...
    restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt',
}).upgrade(tx => {
    // Add deletedLocally field to existing restaurants
    return tx.restaurants.toCollection().modify(restaurant => {
        restaurant.deletedLocally = false;
        restaurant.deletedAt = null;
    });
});
```

---

## User Experience Flow

### Scenario 1: Delete Local Restaurant
```
User: *clicks delete on "My New Restaurant"*
System: Checks source → 'local', serverId → null
Dialog: "Are you sure you want to delete 'My New Restaurant'?
         This local restaurant will be permanently deleted."
User: *clicks OK*
System: PERMANENT DELETE
Result: ✅ Restaurant gone forever
```

### Scenario 2: Delete Synced Restaurant
```
User: *clicks delete on "Ritz" (from server)*
System: Checks source → 'remote', serverId → 1
Dialog: "⚠️ 'Ritz' was synced from the server.
         
         Options:
         • ARCHIVE: Hide locally but keep for next sync (RECOMMENDED)
         • DELETE PERMANENTLY: Remove completely (will re-appear on next sync)
         
         Choose ARCHIVE to hide this restaurant?"
User: *clicks OK*
System: SOFT DELETE (sets deletedLocally: true)
Result: ✅ Hidden from view, preserved in database
```

### Scenario 3: Next Sync After Soft Delete
```
System: Syncing with server...
System: Found "Ritz" on server (serverId: 1)
System: Local version has deletedLocally: true
System: Options:
        A) Keep hidden (respect user's choice)
        B) Ask user if they want to restore
        C) Check server's updated_at vs deletedAt
Recommendation: Keep hidden (Option A)
Implementation: Skip during sync if deletedLocally === true
```

---

## API Enhancement (Future)

If you gain access to server API, implement:

```javascript
// apiHandler.js
async deleteRestaurantOnServer(serverId) {
    const response = await fetch(
        `${this.apiBase}/restaurants/${serverId}`, 
        { method: 'DELETE' }
    );
    return response.ok;
}

// Then update smartDeleteRestaurant:
async smartDeleteRestaurant(restaurantId) {
    const restaurant = await this.db.restaurants.get(restaurantId);
    
    if (restaurant.serverId && restaurant.source === 'remote') {
        // Delete from server first
        try {
            await apiHandler.deleteRestaurantOnServer(restaurant.serverId);
            // Then permanent delete locally
            return await this.permanentDeleteRestaurant(restaurantId);
        } catch (error) {
            // Server delete failed, soft delete locally
            return await this.softDeleteRestaurant(restaurantId);
        }
    }
    
    return await this.permanentDeleteRestaurant(restaurantId);
}
```

---

## Testing Checklist

### Restaurant Delete Tests:

- [ ] Delete local-only restaurant (source='local', serverId=null)
  - Should permanently delete
  - Should not re-appear on sync
  
- [ ] Delete synced restaurant (source='remote', serverId exists)
  - Should soft delete (archive)
  - Should hide from UI
  - Should remain in database
  
- [ ] Restore archived restaurant
  - Should re-appear in list
  - Should clear deletedLocally flag
  
- [ ] Sync after soft delete
  - Should not re-import soft-deleted restaurants
  - Should preserve user's delete choice

### Curator Delete Tests:

- [ ] Try to delete curator with restaurants
  - Should show error message
  - Should not delete
  
- [ ] Try to delete synced curator
  - Should show warning
  - Should offer alternative
  
- [ ] Delete local-only curator without restaurants
  - Should permanently delete
  - Should update UI

---

## Summary

### Current State:
- ✅ Delete UI exists for restaurants
- ✅ Basic delete function works
- ❌ No protection for synced data
- ❌ No curator delete functionality
- ❌ Deleted synced items re-appear on next sync

### Recommended Solution:
- ✅ Smart three-tier delete strategy
- ✅ Soft delete for synced data
- ✅ Permanent delete for local data
- ✅ Protected curator deletion
- ✅ Clear user communication
- ✅ Restore functionality for mistakes

### Implementation Priority:
1. **HIGH:** Add soft delete for restaurants (prevent sync issues)
2. **MEDIUM:** Update UI with better messaging
3. **LOW:** Add curator delete with protection
4. **FUTURE:** Server API integration for true deletes
