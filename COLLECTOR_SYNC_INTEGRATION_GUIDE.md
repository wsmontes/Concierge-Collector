# Collector App Sync Integration Guide

## Overview
This document provides instructions for integrating the enhanced Concierge API sync endpoints into the Collector application to resolve syncing issues, including the "Fix deleting" problem mentioned in the logs.

## API Base URL
```
https://wsmontes.pythonanywhere.com
```

## Enhanced API Endpoints

### 1. Restaurant CRUD Operations

#### Get All Restaurants (Enhanced)
```http
GET /api/restaurants
```
**Response Format (Updated):**
```json
[
  {
    "id": 123,
    "name": "Restaurant Name",
    "description": "Description",
    "transcription": "Audio transcription",
    "timestamp": "2025-10-18T22:00:00",
    "server_id": "srv_456",
    "curator": {
      "id": 1,
      "name": "Curator Name"
    },
    "concepts": [
      {
        "category": "cuisine",
        "value": "italian"
      }
    ]
  }
]
```

#### Get Single Restaurant (NEW)
```http
GET /api/restaurants/{id}
```
**Use Case:** Fetch specific restaurant details for editing or viewing.

#### Update Restaurant (NEW)
```http
PUT /api/restaurants/{id}
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description",
  "server_id": "srv_789",
  "concepts": [
    {"category": "cuisine", "value": "french"}
  ]
}
```
**Use Case:** Update restaurant data, sync server_id after upload.

#### Delete Restaurant (NEW) ⭐ **FIXES DELETION ISSUE**
```http
DELETE /api/restaurants/{id}
```
**Response:**
```json
{
  "status": "success",
  "message": "Restaurant \"Name\" deleted successfully",
  "deleted_restaurant_id": 123,
  "deleted_concepts": 5
}
```
**Use Case:** Properly delete restaurants and all related concepts.

### 2. Sync Management Endpoints

#### Get Sync Status (NEW)
```http
GET /api/restaurants/server-ids?has_server_id=false
```
**Response:**
```json
{
  "status": "success",
  "count": 15,
  "restaurants": [
    {
      "id": 1,
      "name": "Local Restaurant",
      "server_id": null
    }
  ]
}
```
**Use Case:** Identify unsynced local restaurants.

#### Bulk Sync Operations (NEW) ⭐ **ATOMIC TRANSACTIONS**
```http
POST /api/restaurants/sync
Content-Type: application/json

{
  "create": [
    {
      "name": "New Restaurant",
      "description": "Description",
      "server_id": "srv_new_123",
      "concepts": [{"category": "cuisine", "value": "asian"}]
    }
  ],
  "update": [
    {
      "id": 5,
      "server_id": "srv_updated_456",
      "name": "Updated Restaurant"
    }
  ],
  "delete": [7, 8, 9]
}
```
**Response:**
```json
{
  "status": "success",
  "results": {
    "created": 1,
    "updated": 1,
    "deleted": 3,
    "errors": []
  }
}
```

## Collector App Integration Requirements

### 1. Database Schema Updates

**Add server_id tracking to local database:**
```sql
-- Add server_id column to restaurants table
ALTER TABLE restaurants ADD COLUMN server_id VARCHAR(255);
CREATE INDEX idx_restaurants_server_id ON restaurants(server_id);
```

### 2. Sync Service Implementation

#### 2.1 Update SyncService Class

```javascript
class SyncService {
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl || 'https://wsmontes.pythonanywhere.com';
        this.syncInProgress = false;
    }

    // NEW: Get unsynced restaurants
    async getUnsyncedRestaurants() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/restaurants/server-ids?has_server_id=false`);
            const data = await response.json();
            return data.restaurants || [];
        } catch (error) {
            console.error('Error fetching unsynced restaurants:', error);
            return [];
        }
    }

    // NEW: Bulk sync operation
    async bulkSync(operations) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/restaurants/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(operations)
            });
            
            if (!response.ok) {
                throw new Error(`Sync failed: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Bulk sync error:', error);
            throw error;
        }
    }

    // ENHANCED: Full sync workflow
    async performFullSync() {
        if (this.syncInProgress) return;
        
        this.syncInProgress = true;
        
        try {
            // Step 1: Get local unsynced restaurants
            const localRestaurants = await this.getLocalUnsyncedRestaurants();
            
            // Step 2: Get server state
            const serverRestaurants = await this.getServerRestaurants();
            
            // Step 3: Prepare sync operations
            const operations = this.prepareSyncOperations(localRestaurants, serverRestaurants);
            
            // Step 4: Execute bulk sync
            const result = await this.bulkSync(operations);
            
            // Step 5: Update local database with server_ids
            await this.updateLocalServerIds(result);
            
            console.log('Sync completed:', result);
            return result;
            
        } catch (error) {
            console.error('Full sync failed:', error);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    // NEW: Delete restaurant with proper cleanup
    async deleteRestaurant(restaurantId) {
        try {
            // Delete from server
            const response = await fetch(`${this.apiBaseUrl}/api/restaurants/${restaurantId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // Delete from local database
                await this.deleteLocalRestaurant(restaurantId);
                return await response.json();
            } else {
                throw new Error(`Delete failed: ${response.status}`);
            }
        } catch (error) {
            console.error('Delete restaurant error:', error);
            throw error;
        }
    }
}
```

#### 2.2 Update DataStorage Class

```javascript
class DataStorage {
    // ADD: Track server_id in local operations
    async addRestaurant(restaurant) {
        const restaurantWithSync = {
            ...restaurant,
            server_id: restaurant.server_id || null,
            sync_status: restaurant.server_id ? 'synced' : 'local'
        };
        
        return await this.database.restaurants.add(restaurantWithSync);
    }

    // ADD: Get unsynced restaurants
    async getUnsyncedRestaurants() {
        return await this.database.restaurants
            .where('server_id')
            .equals(null)
            .toArray();
    }

    // ADD: Update server_id after sync
    async updateServerIds(updates) {
        for (const update of updates) {
            await this.database.restaurants
                .where('id')
                .equals(update.localId)
                .modify({ 
                    server_id: update.serverId,
                    sync_status: 'synced'
                });
        }
    }

    // ENHANCE: Delete with proper cleanup
    async deleteRestaurant(id) {
        // Delete related concepts first
        await this.database.restaurantConcepts
            .where('restaurantId')
            .equals(id)
            .delete();
            
        // Delete restaurant
        return await this.database.restaurants.delete(id);
    }
}
```

### 3. UI Integration

#### 3.1 Restaurant List Module Updates

```javascript
// ADD: Sync status indicators
function displayRestaurantSyncStatus(restaurant) {
    const statusBadge = restaurant.server_id ? 
        '<span class="badge bg-success">Synced</span>' : 
        '<span class="badge bg-warning">Local</span>';
        
    return statusBadge;
}

// ADD: Delete confirmation with sync awareness
async function deleteRestaurantWithConfirm(restaurantId) {
    const restaurant = await dataStorage.getRestaurant(restaurantId);
    
    const message = restaurant.server_id ? 
        'This will delete the restaurant from both local storage and server. Continue?' :
        'This will delete the local restaurant. Continue?';
        
    if (confirm(message)) {
        try {
            if (restaurant.server_id) {
                // Delete from server and local
                await syncService.deleteRestaurant(restaurantId);
            } else {
                // Delete local only
                await dataStorage.deleteRestaurant(restaurantId);
            }
            
            // Refresh UI
            await loadRestaurantList();
            showNotification('Restaurant deleted successfully', 'success');
        } catch (error) {
            console.error('Delete failed:', error);
            showNotification('Delete failed: ' + error.message, 'error');
        }
    }
}
```

#### 3.2 Background Sync Service Updates

```javascript
class BackgroundSyncService {
    constructor() {
        this.syncInterval = 60000; // 1 minute
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.intervalId = setInterval(async () => {
            try {
                await syncService.performFullSync();
            } catch (error) {
                console.error('Background sync failed:', error);
            }
        }, this.syncInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
    }
}
```

### 4. Error Handling and Conflict Resolution

#### 4.1 Sync Conflict Resolution

```javascript
class ConflictResolver {
    resolveConflicts(localRestaurant, serverRestaurant) {
        // Use timestamp to determine precedence
        const localTime = new Date(localRestaurant.timestamp);
        const serverTime = new Date(serverRestaurant.timestamp);
        
        if (serverTime > localTime) {
            // Server version is newer, use server data
            return { action: 'update_local', data: serverRestaurant };
        } else {
            // Local version is newer, update server
            return { action: 'update_server', data: localRestaurant };
        }
    }
}
```

### 5. Implementation Checklist

- [ ] **Database Schema**: Add server_id column to local restaurants table
- [ ] **SyncService**: Implement new bulk sync methods
- [ ] **DataStorage**: Add server_id tracking to all restaurant operations
- [ ] **Delete Operations**: Replace old delete logic with new API endpoint
- [ ] **UI Updates**: Add sync status indicators
- [ ] **Background Sync**: Implement automatic sync using new endpoints
- [ ] **Error Handling**: Add proper error handling for all sync operations
- [ ] **Conflict Resolution**: Implement timestamp-based conflict resolution

### 6. Testing Recommendations

1. **Test Deletion**: Verify DELETE endpoint resolves the "Fix deleting" issue
2. **Test Bulk Sync**: Ensure atomic transactions work correctly
3. **Test Conflict Resolution**: Create conflicts and verify resolution
4. **Test Network Failures**: Ensure graceful handling of connection issues
5. **Test Partial Sync**: Verify partial success scenarios work correctly

## Benefits of This Integration

✅ **Resolves "Fix deleting" issue** with proper DELETE endpoint  
✅ **Atomic sync operations** prevent data corruption  
✅ **Server_id tracking** enables proper sync state management  
✅ **Bulk operations** improve sync performance  
✅ **Comprehensive error handling** provides better user experience  
✅ **Conflict resolution** handles data inconsistencies  

## Support

If you encounter issues during integration, check:
1. API endpoint responses for error details
2. Network connectivity to the server
3. Database schema includes server_id column
4. Proper Content-Type headers in requests

The enhanced API provides comprehensive sync capabilities that should resolve all reported syncing issues in the Collector application.