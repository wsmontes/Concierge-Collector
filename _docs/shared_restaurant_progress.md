# Shared Restaurant Feature - Implementation Progress

## ✅ Completed (Step 1: Database Layer)

### Database Schema Migration
- **Version 9 added** to dataStorage.js
- New fields added to restaurants table:
  - `sharedRestaurantId` - UUID linking all copies of the same restaurant
  - `originalCuratorId` - ID of the curator who first created the restaurant

### Migration Logic
```javascript
// Automatic upgrade for existing data
- Generates UUID for each existing restaurant
- Sets originalCuratorId = curatorId for existing restaurants
- Maintains backward compatibility
```

### Updated saveRestaurant() Method
**New Signature:**
```javascript
async saveRestaurant(
    name, curatorId, concepts, location, photos,
    transcription, description, source, serverId,
    restaurantId,         // NEW: for updates
    sharedRestaurantId,   // NEW: UUID for linking
    originalCuratorId     // NEW: original creator
)
```

**New Behavior:**
- Auto-generates `sharedRestaurantId` (UUID) for new restaurants
- Auto-sets `originalCuratorId` for new restaurants
- Preserves both fields when provided (for copies/imports)
- Logs shared restaurant info for debugging

---

## 🚧 Next Steps (Step 2-5)

### Step 2: Create Restaurant Copy Method
**File:** `dataStorage.js`

Add new method:
```javascript
async createRestaurantCopy(sourceRestaurantId, newCuratorId) {
    // 1. Get source restaurant with all data
    // 2. Create new restaurant with same data
    // 3. Keep sharedRestaurantId and originalCuratorId
    // 4. Set new curatorId
    // 5. Clear serverId (will sync as new)
    // 6. Copy concepts, location, photos
    // 7. Return new restaurant ID
}
```

### Step 3: Detect and Handle Cross-Curator Editing
**File:** `scripts/modules/conceptModule.js` or `restaurantModule.js`

Update edit restaurant flow:
```javascript
async editRestaurant(restaurantId) {
    const restaurant = await dataStorage.getRestaurant(restaurantId);
    const currentCurator = await dataStorage.getCurrentCurator();
    
    // Check if editing another curator's restaurant
    if (restaurant.curatorId !== currentCurator.id) {
        // Check if copy exists
        const existingCopy = await dataStorage.findRestaurantCopy(
            restaurant.sharedRestaurantId, 
            currentCurator.id
        );
        
        if (existingCopy) {
            // Edit existing copy
            return this.loadForEdit(existingCopy.id);
        } else {
            // Create and edit copy
            const copyId = await dataStorage.createRestaurantCopy(
                restaurantId,
                currentCurator.id
            );
            return this.loadForEdit(copyId);
        }
    }
    
    // Edit own restaurant normally
    return this.loadForEdit(restaurantId);
}
```

### Step 4: Visual Indicators
**Files:** Restaurant card rendering, CSS

Add shared restaurant badge:
```javascript
// In restaurant card HTML
if (restaurant.originalCuratorId !== currentCuratorId) {
    const originalCurator = await getOriginalCurator(restaurant.originalCuratorId);
    badge = `
        <div class="shared-restaurant-badge">
            👤 Based on ${originalCurator.name}'s review
        </div>
    `;
}
```

**CSS:**
```css
.shared-restaurant-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: #6b7280;
    background: #f3f4f6;
    padding: 2px 8px;
    border-radius: 9999px;
    margin-top: 4px;
}
```

### Step 5: Export/Import Updates
**File:** `scripts/modules/exportImportModule.js`

**Export Changes:**
```javascript
// Include new fields in export
remoteRestaurant = {
    name: restaurant.name,
    sharedRestaurantId: restaurant.sharedRestaurantId,  // NEW
    originalCuratorId: restaurant.originalCuratorId,    // NEW
    curator: { id: curator.serverId, name: curator.name },
    // ... other fields
};
```

**Import Changes:**
```javascript
// Preserve new fields on import
await dataStorage.saveRestaurant(
    name, curatorId, concepts, location, photos,
    transcription, description, 'remote', serverId,
    null,  // restaurantId (new)
    remoteRestaurant.sharedRestaurantId,   // preserve
    remoteRestaurant.originalCuratorId     // preserve
);
```

---

## 🧪 Testing Checklist

Once all steps complete:

- [ ] Database migrates successfully (check version 9)
- [ ] New restaurants get sharedRestaurantId automatically
- [ ] New restaurants get originalCuratorId = curatorId
- [ ] Editing own restaurant works normally (no copy)
- [ ] Editing another's restaurant creates copy (first time)
- [ ] Editing another's restaurant edits existing copy (second time)
- [ ] Shared restaurant badge displays correctly
- [ ] Export includes sharedRestaurantId and originalCuratorId
- [ ] Import preserves sharedRestaurantId and originalCuratorId
- [ ] Sync creates separate server records per curator
- [ ] Deleting only removes user's copy
- [ ] Console logs show shared restaurant info

---

## 📋 Implementation Status

| Step | Task | Status |
|------|------|--------|
| 1 | Database migration (Version 9) | ✅ DONE |
| 1 | Update saveRestaurant signature | ✅ DONE |
| 1 | Auto-generate UUIDs | ✅ DONE |
| 1 | Auto-set originalCuratorId | ✅ DONE |
| 2 | Add createRestaurantCopy() | ⏳ TODO |
| 2 | Add findRestaurantCopy() | ⏳ TODO |
| 3 | Update edit flow detection | ⏳ TODO |
| 4 | Add visual badge to cards | ⏳ TODO |
| 4 | Add CSS for badges | ⏳ TODO |
| 5 | Update export to include fields | ⏳ TODO |
| 5 | Update import to preserve fields | ⏳ TODO |
| 6 | Testing | ⏳ TODO |

---

## 🎯 Current State

**Ready to test database migration:**

1. Hard refresh the browser (Cmd+Shift+R)
2. Open DevTools Console
3. Look for: "Upgrading database to version 9: Adding shared restaurant fields"
4. Check existing restaurants have UUIDs:
   ```javascript
   // Run in console
   (await dataStorage.db.restaurants.toArray()).forEach(r => 
       console.log(r.name, r.sharedRestaurantId, r.originalCuratorId)
   );
   ```

**Expected output:**
- Each restaurant has a sharedRestaurantId (UUID format)
- Each restaurant has originalCuratorId (should match curatorId for existing data)

---

## 💡 Next Action

After confirming migration works:
1. Implement createRestaurantCopy() method
2. Implement findRestaurantCopy() method  
3. Update edit restaurant flow
4. Add visual indicators
5. Update export/import

**Estimated time:** 30-45 minutes for remaining steps

