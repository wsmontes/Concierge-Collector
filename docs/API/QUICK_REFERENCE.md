# API JSON Endpoint - Quick Reference Card

**Last Updated:** October 20, 2025

---

## 🚀 Quick Start

### Enable JSON Endpoint (Console - Temporary)
```javascript
window.AppConfig.api.backend.sync.useJsonEndpoint = true;
```

### Enable JSON Endpoint (Config - Permanent)
Edit `scripts/config.js`:
```javascript
sync: { useJsonEndpoint: true }
```

---

## 📊 Endpoint Comparison

| Feature | /batch | /json |
|---------|--------|-------|
| Location | ❌ | ✅ |
| Photos | ❌ | ✅ |
| Notes | ❌ | ✅ |
| Michelin | ❌ | ✅ |
| Google Places | ❌ | ✅ |
| Server ID | ✅ | ❌ |
| Duplicate Check | Name only | Name+City+Curator |

---

## 🧪 Quick Test

```javascript
// Test upload
const test = {
    id: Date.now(),
    name: "Test Restaurant",
    curatorId: 1,
    curatorName: "Test",
    concepts: [{ category: "Cuisine", value: "Italian" }],
    location: { address: "Rome, Italy" },
    michelinData: { guide: { city: "Rome" } }
};

const result = await window.apiService.uploadRestaurantJson(test);
console.log(result.success ? '✅ Success' : '❌ Failed', result);
```

---

## ✅ Validation

```javascript
// Validate before upload
const validation = window.restaurantValidator.validateForUpload(restaurant);
console.log('Valid:', validation.valid);
console.log('City:', validation.city);
console.log('Issues:', validation.issues);
```

---

## 🔄 Sync Single Restaurant

```javascript
// Sync one restaurant
await window.conciergeSync.syncRestaurantById(restaurantId, false);
```

---

## 📦 Migrate All Pending

```javascript
// Get pending count
const pending = await dataStorage.db.restaurants
    .where('needsSync').equals(true).count();
console.log(`${pending} restaurants pending`);

// Sync all pending
await window.conciergeSync.syncPendingRestaurants();
```

---

## 🔍 Check Status

```javascript
// Current endpoint
console.log('Using JSON endpoint:', 
    window.AppConfig.api.backend.sync.useJsonEndpoint
);

// Sync stats
const all = await dataStorage.db.restaurants.toArray();
const stats = {
    total: all.length,
    synced: all.filter(r => !r.needsSync).length,
    pending: all.filter(r => r.needsSync).length
};
console.table(stats);
```

---

## 🛠️ Rollback

```javascript
// Switch back to batch endpoint
window.AppConfig.api.backend.sync.useJsonEndpoint = false;
```

---

## ⚠️ Common Issues

### City extraction failed
```javascript
// Add city data
await dataStorage.db.restaurants.update(id, {
    michelinData: { guide: { city: "CityName" } }
});
```

### Validation warnings
```javascript
// Check what's missing
const validation = window.restaurantValidator.validateForUpload(restaurant);
console.log(validation.issues);
```

### Sync failed
```javascript
// Retry individual
await window.conciergeSync.syncRestaurantById(id, false);
```

---

## 📚 Documentation

- **Complete Guide:** `docs/API/API_INTEGRATION_COMPLETE.md`
- **Testing:** `docs/API/API_TESTING_GUIDE.md`
- **Migration:** `docs/API/MIGRATION_GUIDE.md`
- **Summary:** `docs/API/IMPLEMENTATION_SUMMARY.md`

---

## 🎯 Decision Tree

```
Do you have location/photos/notes?
├─ YES → Use JSON endpoint (/curation/json) ✅
└─ NO → Stay on batch endpoint (/restaurants/batch) ⚠️

Need to delete restaurants?
├─ YES → Use sync endpoint (/restaurants/sync) ⚠️
└─ NO → Use batch or JSON

Want future-proof integration?
└─ YES → Migrate to JSON endpoint ✅
```

---

## 📞 Quick Commands

```javascript
// Enable JSON
window.AppConfig.api.backend.sync.useJsonEndpoint = true;

// Test validator
window.restaurantValidator.extractCity(restaurant);

// Upload one
window.apiService.uploadRestaurantJson(restaurant);

// Sync one
window.conciergeSync.syncRestaurantById(id, false);

// Check config
console.log(window.AppConfig.api.backend.sync);

// Disable JSON
window.AppConfig.api.backend.sync.useJsonEndpoint = false;
```

---

**Print this card for quick reference during testing and migration!**
