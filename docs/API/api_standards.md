# API Standards and Integration Guide
**Last Updated:** October 19, 2025  
**Version:** 2.0

## Table of Contents
1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Making API Calls](#making-api-calls)
4. [Error Handling](#error-handling)
5. [Response Format](#response-format)
6. [Best Practices](#best-practices)
7. [Examples](#examples)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This document defines the **mandatory patterns and standards** for all API interactions in the Concierge Collector application.

### Core Principles
1. **Centralized Configuration**: All API URLs, timeouts, and settings must be in `config.js`
2. **Single Service Layer**: All external API calls must go through `apiService.js`
3. **Consistent Error Handling**: Use standardized error handling patterns
4. **Uniform Response Format**: All API methods return the same response structure
5. **No Direct fetch()**: Never call `fetch()` directly - always use `apiService`

### API Services Used
- **Concierge Collector API V3** - Backend FastAPI + MongoDB (restaurants, curations, AI orchestration)
- **OpenAI API** - Whisper transcription and GPT-4 analysis
- **Google Places API** - Restaurant search and location data

---

## Configuration

### Loading Configuration

Configuration **must be loaded first** before any other scripts:

```html
<!-- index.html -->
<script src="scripts/config.js"></script>
<script src="scripts/apiService.js" defer></script>
```

### Accessing Configuration

```javascript
// ✅ Correct - Use AppConfig
const backendUrl = AppConfig.api.backend.baseUrl;
const timeout = AppConfig.api.backend.timeout;
const openAiModel = AppConfig.api.openai.models.gpt;

// ✅ Helper methods
const restaurantsUrl = AppConfig.getBackendUrl('restaurants');
const apiKey = AppConfig.getApiKey('openaiApiKey');

// ❌ Wrong - Don't hardcode
const backendUrl = 'https://concierge-collector.onrender.com/api';
const apiKey = localStorage.getItem('openai_api_key');
```

### Adding New Configuration

Edit `scripts/config.js` only:

```javascript
const AppConfig = {
    api: {
        newService: {
            baseUrl: 'https://api.example.com',
            timeout: 10000,
            endpoints: {
                getData: '/data',
                postData: '/data/create'
            }
        }
    }
};
```

---

## Making API Calls

### Rule: Always Use apiService

**NEVER** call `fetch()` directly. **ALWAYS** use `apiService` methods.

```javascript
// ✅ Correct
const result = await apiService.getRestaurants();

// ❌ Wrong - Direct fetch is forbidden
const response = await fetch('https://api.example.com/data');
```

### Available apiService Methods

#### Backend (Concierge Parser API)

```javascript
// Get all restaurants
const result = await apiService.getRestaurants();

// Get single restaurant
const result = await apiService.getRestaurant(restaurantId);

// Create restaurant (use batch instead)
const result = await apiService.createRestaurant(restaurantData);

// Update restaurant
const result = await apiService.updateRestaurant(restaurantId, updatedData);

// Delete restaurant
const result = await apiService.deleteRestaurant(restaurantId);

// Batch upload restaurants (preferred for new restaurants)
const result = await apiService.batchUploadRestaurants([restaurant1, restaurant2]);

// Create curator
const result = await apiService.createCurator(curatorData);

// Get Michelin staging restaurants
const result = await apiService.getMichelinStaging({ page: 1, limit: 20 });

// Approve Michelin restaurant
const result = await apiService.approveMichelinRestaurant(restaurantName);
```

#### OpenAI API

```javascript
// Transcribe audio
const result = await apiService.transcribeAudio(audioBlob, 'audio.mp3');

// Analyze with GPT
const result = await apiService.analyzeWithGPT(
    'Extract restaurant concepts from this text: ...',
    'You are a restaurant concept expert.'
);
```

### Adding New API Methods

If `apiService` doesn't have the method you need, add it to `apiService.js`:

```javascript
// In apiService.js
async getRestaurantsByCity(city) {
    return this.get('/restaurants', { city });
}
```

Then use it:

```javascript
const result = await apiService.getRestaurantsByCity('New York');
```

---

## Error Handling

### Standard Error Handling Pattern

All `apiService` methods return a consistent response format. **Always check `success` first**:

```javascript
// ✅ Correct - Check success field
const result = await apiService.getRestaurants();

if (result.success) {
    // Handle success
    const restaurants = result.data;
    console.log('Got restaurants:', restaurants);
} else {
    // Handle error
    console.error('Error:', result.error);
    SafetyUtils.showNotification(result.error, 'error');
}

// ❌ Wrong - Don't use try/catch at call site
try {
    const result = await apiService.getRestaurants();
    // This won't catch API errors - they're in result.error
} catch (error) {
    // This only catches JavaScript errors, not API errors
}
```

### Error Types

```javascript
// Network error (offline, timeout, etc.)
{
    success: false,
    error: 'Network error. Please check your internet connection.',
    data: null
}

// HTTP error (404, 500, etc.)
{
    success: false,
    error: 'Resource not found on server',
    status: 404,
    data: null
}

// API-specific error
{
    success: false,
    error: 'Invalid restaurant data: name is required',
    status: 400,
    data: { field: 'name', message: 'required' }
}
```

### User-Friendly Error Messages

The `apiService` already provides user-friendly error messages. Display them directly:

```javascript
const result = await apiService.updateRestaurant(id, data);

if (!result.success) {
    // Error message is already user-friendly
    SafetyUtils.showNotification(result.error, 'error');
    return;
}

// Success
SafetyUtils.showNotification('Restaurant updated successfully!', 'success');
```

---

## Response Format

### Standard Response Structure

All `apiService` methods return this format:

```javascript
// Success
{
    success: true,
    data: any,           // Response data (object, array, or null)
    status: 200         // HTTP status code
}

// Error
{
    success: false,
    error: string,       // User-friendly error message
    status: number,      // HTTP status code (if available)
    data: any           // Error details (if available)
}
```

### Examples

```javascript
// Get restaurants - Success
{
    success: true,
    data: [
        { id: 1, name: 'Restaurant A', ... },
        { id: 2, name: 'Restaurant B', ... }
    ],
    status: 200
}

// Update restaurant - Success (no response body)
{
    success: true,
    data: null,
    status: 204
}

// Create restaurant - Error
{
    success: false,
    error: 'Restaurant with this name already exists',
    status: 409,
    data: { existingId: 123 }
}
```

---

## Best Practices

### 1. Check for Success First

```javascript
// ✅ Correct
const result = await apiService.getRestaurants();
if (result.success) {
    processRestaurants(result.data);
} else {
    handleError(result.error);
}

// ❌ Wrong - Don't assume success
const result = await apiService.getRestaurants();
processRestaurants(result.data); // May be undefined if error
```

### 2. Handle Errors Gracefully

```javascript
// ✅ Correct - Provide fallback behavior
const result = await apiService.getRestaurants();
if (result.success) {
    displayRestaurants(result.data);
} else {
    // Show error to user
    SafetyUtils.showNotification(result.error, 'error');
    // Use cached data or empty state
    displayRestaurants(getCachedRestaurants());
}

// ❌ Wrong - Don't ignore errors
const result = await apiService.getRestaurants();
displayRestaurants(result.data || []); // Silently fails
```

### 3. Use Semantic Method Names

```javascript
// ✅ Correct - Clear what it does
async syncRestaurantToServer(restaurant) {
    const result = await apiService.batchUploadRestaurants([restaurant]);
    return result;
}

// ❌ Wrong - Unclear method name
async doSync(data) {
    const result = await apiService.post('/restaurants/batch', data);
    return result;
}
```

### 4. Don't Duplicate API Logic

```javascript
// ✅ Correct - Use existing apiService methods
const restaurants = await apiService.getRestaurants();

// ❌ Wrong - Don't reimplement API calls
async function getRestaurants() {
    const url = AppConfig.api.backend.baseUrl + '/restaurants';
    const response = await fetch(url);
    return await response.json();
}
```

### 5. Log Appropriately

```javascript
// ✅ Correct - Log important operations
console.log('Fetching restaurants from server...');
const result = await apiService.getRestaurants();
if (result.success) {
    console.log(`✅ Got ${result.data.length} restaurants`);
} else {
    console.error('❌ Failed to fetch restaurants:', result.error);
}

// ❌ Wrong - Too much or too little logging
const result = await apiService.getRestaurants(); // No log
// or
console.log('result:', result, 'data:', result.data, ...); // Too verbose
```

---

## Examples

### Example 1: Fetching and Displaying Restaurants

```javascript
async function loadRestaurants() {
    // Show loading state
    showLoadingSpinner();
    
    // Make API call
    const result = await apiService.getRestaurants();
    
    // Hide loading state
    hideLoadingSpinner();
    
    // Handle result
    if (result.success) {
        const restaurants = result.data;
        displayRestaurants(restaurants);
        SafetyUtils.showNotification(`Loaded ${restaurants.length} restaurants`, 'success');
    } else {
        // Show error
        SafetyUtils.showNotification(`Failed to load restaurants: ${result.error}`, 'error');
        // Show empty state or cached data
        displayRestaurants([]);
    }
}
```

### Example 2: Creating a Restaurant

```javascript
async function createNewRestaurant(restaurantData) {
    // Validate input
    if (!restaurantData.name) {
        SafetyUtils.showNotification('Restaurant name is required', 'error');
        return null;
    }
    
    // Make API call
    const result = await apiService.batchUploadRestaurants([restaurantData]);
    
    // Handle result
    if (result.success) {
        const createdRestaurant = result.data.restaurants[0];
        SafetyUtils.showNotification('Restaurant created successfully!', 'success');
        return createdRestaurant;
    } else {
        SafetyUtils.showNotification(`Failed to create restaurant: ${result.error}`, 'error');
        return null;
    }
}
```

### Example 3: Updating with Error Recovery

```javascript
async function updateRestaurant(restaurantId, updates) {
    const result = await apiService.updateRestaurant(restaurantId, updates);
    
    if (result.success) {
        // Update succeeded
        await refreshRestaurantList();
        SafetyUtils.showNotification('Restaurant updated!', 'success');
        return true;
    } else {
        // Check if it's a conflict error
        if (result.status === 409) {
            const retry = await confirmDialog('Restaurant was modified by another user. Retry?');
            if (retry) {
                return await updateRestaurant(restaurantId, updates);
            }
        }
        
        // Show error
        SafetyUtils.showNotification(`Update failed: ${result.error}`, 'error');
        return false;
    }
}
```

### Example 4: Batch Operations

```javascript
async function syncMultipleRestaurants(restaurants) {
    console.log(`Syncing ${restaurants.length} restaurants...`);
    
    // Use batch endpoint for efficiency
    const result = await apiService.batchUploadRestaurants(restaurants);
    
    if (result.success) {
        const { restaurants: synced, errors } = result.data;
        
        console.log(`✅ Synced ${synced.length} restaurants`);
        
        if (errors && errors.length > 0) {
            console.warn(`⚠️ ${errors.length} restaurants had errors`);
            SafetyUtils.showNotification(
                `Synced ${synced.length} restaurants, ${errors.length} failed`,
                'warning'
            );
        } else {
            SafetyUtils.showNotification(
                `All ${synced.length} restaurants synced successfully!`,
                'success'
            );
        }
        
        return synced;
    } else {
        SafetyUtils.showNotification(`Sync failed: ${result.error}`, 'error');
        return [];
    }
}
```

---

## Common Patterns

### Pattern 1: Load-Update-Refresh

```javascript
// 1. Load current data
const loadResult = await apiService.getRestaurant(restaurantId);
if (!loadResult.success) {
    showError(loadResult.error);
    return;
}

// 2. Modify data
const restaurant = loadResult.data;
restaurant.name = 'New Name';

// 3. Update on server
const updateResult = await apiService.updateRestaurant(restaurantId, restaurant);
if (!updateResult.success) {
    showError(updateResult.error);
    return;
}

// 4. Refresh display
await refreshRestaurantList();
```

### Pattern 2: Create-Sync-Display

```javascript
// 1. Create locally
const localRestaurant = await dataStorage.saveRestaurant({
    name: 'New Restaurant',
    source: 'local',
    ...otherData
});

// 2. Sync to server
const syncResult = await apiService.batchUploadRestaurants([localRestaurant]);
if (syncResult.success) {
    const serverRestaurant = syncResult.data.restaurants[0];
    
    // 3. Update local with server ID
    await dataStorage.updateRestaurant(localRestaurant.id, {
        serverId: serverRestaurant.id,
        source: 'remote'
    });
}

// 4. Refresh display
await refreshRestaurantList();
```

### Pattern 3: Retry with Exponential Backoff

```javascript
async function fetchWithRetry(operation, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await operation();
        
        if (result.success) {
            return result;
        }
        
        // Don't retry on client errors (4xx)
        if (result.status >= 400 && result.status < 500) {
            return result;
        }
        
        // Retry on server errors (5xx) or network errors
        if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
            console.log(`Retry attempt ${attempt} after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { success: false, error: 'Max retries exceeded' };
}

// Usage
const result = await fetchWithRetry(() => apiService.getRestaurants());
```

---

## Troubleshooting

### Problem: "apiService is not defined"

**Solution:** Ensure `apiService.js` is loaded and initialized:

```html
<script src="scripts/config.js"></script>
<script src="scripts/moduleWrapper.js"></script>
<script src="scripts/apiService.js" defer></script>
```

### Problem: "AppConfig is not defined"

**Solution:** Ensure `config.js` loads **before** `apiService.js`:

```html
<script src="scripts/config.js"></script>
<script src="scripts/apiService.js" defer></script>
```

### Problem: API calls fail with CORS error

**Solution:** Backend must include CORS headers. Check:
- Server has `Access-Control-Allow-Origin` header
- Request includes `mode: 'cors'` (apiService does this automatically)

### Problem: Timeout errors

**Solution:** Increase timeout in `config.js`:

```javascript
api: {
    backend: {
        timeout: 60000  // Increase to 60 seconds
    }
}
```

### Problem: Response is undefined

**Solution:** Always check `success` field first:

```javascript
// ❌ Wrong
const restaurants = (await apiService.getRestaurants()).data;

// ✅ Correct
const result = await apiService.getRestaurants();
const restaurants = result.success ? result.data : [];
```

---

## Migration Guide

### Migrating from Direct fetch()

```javascript
// ❌ Before - Direct fetch
async function getRestaurants() {
    try {
        const response = await fetch('https://api.example.com/restaurants');
        if (!response.ok) throw new Error('Failed');
        return await response.json();
    } catch (error) {
        console.error(error);
        return [];
    }
}

// ✅ After - Using apiService
async function getRestaurants() {
    const result = await apiService.getRestaurants();
    if (result.success) {
        return result.data;
    } else {
        console.error('Error:', result.error);
        SafetyUtils.showNotification(result.error, 'error');
        return [];
    }
}
```

### Migrating from apiHandler.js

```javascript
// ❌ Before - apiHandler
const result = await apiHandler.post('/restaurants', restaurantData);
if (result.success) {
    console.log('Created:', result.data);
}

// ✅ After - apiService
const result = await apiService.batchUploadRestaurants([restaurantData]);
if (result.success) {
    console.log('Created:', result.data.restaurants[0]);
}
```

---

## Checklist for New API Integrations

- [ ] Configuration added to `config.js`
- [ ] Method added to `apiService.js`
- [ ] Follows standard response format
- [ ] Error handling implemented
- [ ] User-friendly error messages
- [ ] Logging added for debugging
- [ ] Tested with success and error cases
- [ ] Documentation updated

---

**Remember:** The goal is **consistency, reliability, and maintainability**. Following these standards ensures all API interactions work the same way throughout the application.
