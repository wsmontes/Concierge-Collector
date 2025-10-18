# Shared Restaurant Feature - Quick Reference

## 🎯 What It Does

Prevents data loss when curators edit each other's restaurants by automatically creating personal copies.

---

## 🔑 Key Concepts

**Shared Restaurant ID (UUID)**
- Links all copies of the same restaurant
- Generated automatically for new restaurants
- Never changes, even for copies

**Original Curator ID**
- Tracks who first created the restaurant
- Powers the "Based on X's review" badge
- Preserved across all copies

---

## 💡 User Experience

### Scenario 1: Edit Your Own Restaurant
```
Click Edit → Opens edit form → Make changes → Save
✅ Updates your restaurant in place (no copy)
```

### Scenario 2: Edit Another Curator's Restaurant (First Time)
```
Click Edit → "Creating your copy..." → Edit form opens → Make changes → Save
✅ Creates YOUR copy, original stays unchanged
✅ Badge shows "👤 Based on [Name]'s review"
```

### Scenario 3: Edit Another Curator's Restaurant (Again)
```
Click Edit → "Editing your copy..." → Edit form opens → Make changes → Save
✅ Uses your existing copy (doesn't create new one)
```

---

## 📊 Visual Indicators

**Your Restaurant:**
- No badge
- Normal display

**Shared Restaurant (Your Copy):**
- Badge: "👤 Based on [Name]'s review"
- Gray background, rounded pill shape
- Appears below restaurant name

---

## 🔧 Technical Details

### Database Schema
```javascript
{
    id: 1,                        // Local ID
    serverId: 123,                // Server ID
    sharedRestaurantId: "uuid",   // Links copies
    originalCuratorId: 2,         // Original creator
    curatorId: 1,                 // Current owner
    name: "Restaurant Name",
    // ... other fields
}
```

### Key Methods
```javascript
// Check if copy exists
await dataStorage.findRestaurantCopy(sharedRestaurantId, curatorId)

// Create a copy
await dataStorage.createRestaurantCopy(sourceId, newCuratorId)
```

---

## 🧪 Quick Test

Run in browser console after hard refresh:

```javascript
// 1. Check migration worked
(await dataStorage.db.restaurants.toArray())[0]
// Should have sharedRestaurantId and originalCuratorId

// 2. Find another curator's restaurant
const others = (await dataStorage.db.restaurants.toArray())
    .filter(r => r.curatorId !== (await dataStorage.getCurrentCurator()).id)
console.log(others[0])

// 3. Create test copy
const copyId = await dataStorage.createRestaurantCopy(others[0].id, 
    (await dataStorage.getCurrentCurator()).id)
console.log('Copy created:', copyId)
```

---

## 📁 Files Changed

| File | Changes | Lines |
|------|---------|-------|
| dataStorage.js | Version 9, copy methods | ~150 |
| restaurantModule.js | Edit detection | ~45 |
| exportImportModule.js | Field preservation | ~20 |
| style.css | Badge styling | ~30 |

---

## ✅ Quick Checklist

After hard refresh:

- [ ] Console: "Upgrading database to version 9"
- [ ] All restaurants have UUIDs
- [ ] Edit another's restaurant → Creates copy
- [ ] Badge shows on copied restaurants
- [ ] Export includes new fields
- [ ] No errors in console

---

## 🚨 Troubleshooting

**No UUIDs?**
→ Clear browser data, reload

**No badge showing?**
→ Check console, verify originalCuratorId exists

**Copy not created?**
→ Check console for errors, verify methods exist

**Export missing fields?**
→ Check network tab, verify request body

---

## 📚 Documentation

- Full implementation: `shared_restaurant_implementation.md`
- Progress tracking: `shared_restaurant_progress.md`
- Complete guide: `shared_restaurant_complete.md`
- User summary: `shared_restaurant_summary_for_user.md`

---

## 🎉 Status: READY FOR TESTING

All features implemented and functional!

