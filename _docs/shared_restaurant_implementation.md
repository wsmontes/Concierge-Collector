# Shared Restaurant Implementation Plan

## Overview
When a curator edits a restaurant created by another curator, instead of modifying the original, the system will create a curator-specific copy while maintaining a shared identity across all copies.

## Problem Statement
Currently, if Curator A edits a restaurant created by Curator B:
- ❌ The original restaurant is modified (data integrity issue)
- ❌ Curator B loses their original data
- ❌ No way to track that these are views of the same restaurant
- ❌ Potential for server conflicts and data loss

## Solution: Shared Restaurant ID System

### Core Concept
Each restaurant has:
1. **Local ID** (`id`) - Unique to this copy in IndexedDB
2. **Server ID** (`serverId`) - Unique on server (if synced)
3. **Shared Restaurant ID** (`sharedRestaurantId`) - Links all copies of the same restaurant

### Data Structure Changes

#### Database Schema (Version 9)
```javascript
restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId'
```

**New Fields:**
- `sharedRestaurantId`: UUID linking all copies of the same restaurant
- `originalCuratorId`: ID of the curator who first created this restaurant

#### Restaurant Object Structure
```javascript
{
    id: 1,                          // Local IndexedDB ID
    serverId: 123,                  // Server ID (if synced)
    sharedRestaurantId: "uuid-...", // Links all copies
    originalCuratorId: 2,           // Original creator
    curatorId: 1,                   // Current owner
    name: "Restaurant Name",
    // ... other fields
}
```

### Behavior Flow

#### Scenario 1: Creating New Restaurant
```
User creates restaurant
  ↓
Generate new sharedRestaurantId (UUID)
  ↓
Set originalCuratorId = currentCuratorId
  ↓
Save to local DB
  ↓
Sync to server (includes sharedRestaurantId)
```

#### Scenario 2: Editing Own Restaurant
```
User clicks edit on own restaurant
  ↓
Load existing data
  ↓
User modifies fields
  ↓
Update same record (no copy)
  ↓
Sync changes to server
```

#### Scenario 3: Editing Another Curator's Restaurant
```
User clicks edit on restaurant with different curatorId
  ↓
Detect curatorId !== currentCuratorId
  ↓
Check if user already has a copy (by sharedRestaurantId)
  ↓
  If YES: Edit existing copy
  If NO: Create new copy
     ↓
     Copy all data to new restaurant
     ↓
     Keep same sharedRestaurantId
     ↓
     Set curatorId = currentCuratorId
     ↓
     Keep originalCuratorId from source
     ↓
     Generate new local ID
     ↓
     Clear serverId (will get new one on sync)
  ↓
User modifies fields
  ↓
Save changes to user's copy only
  ↓
Sync to server with sharedRestaurantId
```

### Visual Indicators

#### Restaurant Card Display
```
┌─────────────────────────────────────┐
│ 🍽️ Restaurant Name                  │
│                                     │
│ 👤 Based on Wagner's review         │ ← NEW: Shows if from another curator
│                                     │
│ Description...                      │
│                                     │
│ [View Details] [Edit]               │
└─────────────────────────────────────┘
```

#### In Edit Form
```
┌────────────────────────────────────────┐
│ ℹ️ Originally created by Wagner        │ ← NEW: Info banner
│ Your changes create your own version   │
└────────────────────────────────────────┘
```

### Implementation Files

#### 1. Database Migration (dataStorage.js)
```javascript
// Add version 9 upgrade
this.db.version(9).stores({
    restaurants: '++id, name, curatorId, ..., sharedRestaurantId, originalCuratorId'
}).upgrade(tx => {
    return tx.restaurants.toCollection().modify(restaurant => {
        // Generate UUID for existing restaurants
        if (!restaurant.sharedRestaurantId) {
            restaurant.sharedRestaurantId = crypto.randomUUID();
        }
        // Set originalCuratorId for existing restaurants
        if (!restaurant.originalCuratorId) {
            restaurant.originalCuratorId = restaurant.curatorId;
        }
    });
});
```

#### 2. Save Restaurant Logic (dataStorage.js)
```javascript
async saveRestaurant(...) {
    // Generate sharedRestaurantId for new restaurants
    if (!restaurantId && !sharedRestaurantId) {
        sharedRestaurantId = crypto.randomUUID();
        originalCuratorId = curatorId;
    }
    
    // Add to restaurant object
    const restaurant = {
        // ... existing fields
        sharedRestaurantId,
        originalCuratorId: originalCuratorId || curatorId
    };
}
```

#### 3. Edit Restaurant Detection (conceptModule.js or restaurantModule.js)
```javascript
async editRestaurant(restaurantId) {
    const restaurant = await dataStorage.getRestaurant(restaurantId);
    const currentCurator = await dataStorage.getCurrentCurator();
    
    // Check if editing another curator's restaurant
    if (restaurant.curatorId !== currentCurator.id) {
        // Check if user already has a copy
        const existingCopy = await dataStorage.db.restaurants
            .where('sharedRestaurantId').equals(restaurant.sharedRestaurantId)
            .and(r => r.curatorId === currentCurator.id)
            .first();
        
        if (existingCopy) {
            // Edit existing copy
            return this.loadRestaurantForEdit(existingCopy.id);
        } else {
            // Create copy
            return this.createRestaurantCopy(restaurant, currentCurator.id);
        }
    }
    
    // Edit own restaurant normally
    return this.loadRestaurantForEdit(restaurantId);
}
```

#### 4. Create Restaurant Copy
```javascript
async createRestaurantCopy(sourceRestaurant, newCuratorId) {
    // Copy all data except IDs and curator-specific fields
    const copy = {
        name: sourceRestaurant.name,
        transcription: sourceRestaurant.transcription,
        description: sourceRestaurant.description,
        sharedRestaurantId: sourceRestaurant.sharedRestaurantId,
        originalCuratorId: sourceRestaurant.originalCuratorId,
        curatorId: newCuratorId,
        origin: 'local',
        source: 'local',
        // serverId will be null until synced
        timestamp: Date.now()
    };
    
    // Copy concepts
    const concepts = await dataStorage.getRestaurantConcepts(sourceRestaurant.id);
    
    // Copy location
    const location = await dataStorage.getRestaurantLocation(sourceRestaurant.id);
    
    // Copy photos
    const photos = await dataStorage.getRestaurantPhotos(sourceRestaurant.id);
    
    // Save new copy
    const newId = await dataStorage.saveRestaurant(
        copy.name, newCuratorId, concepts, location, photos,
        copy.transcription, copy.description, 'local', null,
        null, copy.sharedRestaurantId, copy.originalCuratorId
    );
    
    return newId;
}
```

#### 5. Display Shared Restaurant Badge (HTML/JS)
```javascript
function renderRestaurantCard(restaurant, currentCuratorId) {
    const isShared = restaurant.curatorId !== restaurant.originalCuratorId ||
                     restaurant.curatorId !== currentCuratorId;
    
    let sharedBadge = '';
    if (isShared && restaurant.originalCuratorId !== currentCuratorId) {
        const originalCurator = await dataStorage.db.curators
            .get(restaurant.originalCuratorId);
        sharedBadge = `
            <div class="shared-restaurant-badge">
                👤 Based on ${originalCurator.name}'s review
            </div>
        `;
    }
    
    return `
        <div class="restaurant-card">
            <h3>${restaurant.name}</h3>
            ${sharedBadge}
            <!-- rest of card -->
        </div>
    `;
}
```

#### 6. Export/Import Handling (exportImportModule.js)

**Export:**
```javascript
async exportToRemote() {
    // Include sharedRestaurantId and originalCuratorId in export
    const remoteRestaurant = {
        name: restaurant.name,
        sharedRestaurantId: restaurant.sharedRestaurantId,
        originalCuratorId: restaurant.originalCuratorId,
        curator: { id: curator.serverId, name: curator.name },
        // ... other fields
    };
}
```

**Import:**
```javascript
async importFromRemote() {
    // When importing, preserve sharedRestaurantId
    await dataStorage.saveRestaurant(
        name, curatorId, concepts, location, photos,
        transcription, description, 'remote', serverId,
        null, // restaurantId (new)
        remoteRestaurant.sharedRestaurantId, // preserve
        remoteRestaurant.originalCuratorId   // preserve
    );
}
```

### Server-Side Considerations

The server should:
1. ✅ Accept `sharedRestaurantId` in POST/PUT requests
2. ✅ Store `sharedRestaurantId` with each restaurant
3. ✅ Return `sharedRestaurantId` in GET responses
4. ✅ Allow multiple restaurants with same `sharedRestaurantId` but different `curatorId`

### Edge Cases

#### Case 1: Importing Shared Restaurant
```
Scenario: Curator A has Restaurant X, Curator B imports from server
Result: Curator B gets their own copy with same sharedRestaurantId
```

#### Case 2: Syncing Multiple Copies
```
Scenario: Both curators edit their copies and sync
Result: Server stores both copies with different serverIds but same sharedRestaurantId
```

#### Case 3: Deleting Shared Restaurant
```
Scenario: Curator deletes their copy
Result: Only their copy is deleted, other copies remain intact
```

#### Case 4: Original Curator Unknown
```
Scenario: Old restaurant without originalCuratorId
Result: Migration sets originalCuratorId = curatorId
```

### Testing Checklist

- [ ] Create new restaurant → generates sharedRestaurantId
- [ ] Edit own restaurant → modifies in place
- [ ] Edit another's restaurant (first time) → creates copy
- [ ] Edit another's restaurant (second time) → edits existing copy
- [ ] Visual badge shows correctly
- [ ] Export includes sharedRestaurantId
- [ ] Import preserves sharedRestaurantId
- [ ] Sync creates separate server records
- [ ] Delete only removes user's copy
- [ ] Migration adds fields to existing data

### Benefits

✅ **Data Integrity**: Each curator's data is isolated
✅ **Collaboration**: Curators can adapt others' restaurants
✅ **Traceability**: Always know the original source
✅ **Sync Safety**: No conflicts between curators
✅ **User Experience**: Clear visual indication of shared restaurants

### Implementation Order

1. Database migration (add fields)
2. Update saveRestaurant to handle new fields
3. Add copy detection in edit flow
4. Add createRestaurantCopy method
5. Update UI to show shared badge
6. Update export to include new fields
7. Update import to preserve new fields
8. Add CSS for visual indicators
9. Test all scenarios
10. Document for users

