# V2 Export Format - Test Plan

## Test Date: October 17, 2025

## Implementation Checklist

### ✅ Phase 1: Core Implementation
- [x] Created `exportDataV2()` function in dataStorage.js
- [x] Added conditional inclusion logic (only export what exists)
- [x] Implemented metadata array structure
- [x] Added restaurant metadata (conditional on serverId/deleted/modified)
- [x] Added collector data section (always present)
- [x] Added placeholders for Michelin and Google Places data
- [x] Implemented curator categories at root level
- [x] Updated exportImportModule to add V2 option
- [x] Updated export format selection modal
- [x] Connected V2 export to UI button

### ⏳ Phase 2: Testing
- [ ] Test minimal restaurant (name + 1 concept)
- [ ] Test restaurant with photos
- [ ] Test restaurant with location
- [ ] Test restaurant with description and transcription
- [ ] Test synced restaurant (with serverId)
- [ ] Test deleted restaurant (deletedLocally = true)
- [ ] Test restaurant with all data
- [ ] Verify JSON structure matches specification
- [ ] Verify conditional fields are omitted when empty
- [ ] Verify no null values in output
- [ ] Verify no empty arrays in output

### ⏳ Phase 3: Edge Cases
- [ ] Restaurant with no concepts
- [ ] Restaurant with empty description
- [ ] Restaurant with null location
- [ ] Restaurant with empty photo array
- [ ] Multiple restaurants with different data combinations

## Test Scenarios

### Scenario 1: Minimal Restaurant
**Expected Output:**
```json
{
  "metadata": [
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Test Restaurant"
      }
    }
  ],
  "Cuisine": ["Italian"]
}
```

**Validation:**
- ✅ Only collector data in metadata
- ✅ No restaurant metadata (no serverId)
- ✅ No photos, location, description, or transcription
- ✅ Only one curator category

---

### Scenario 2: Restaurant with Photos
**Expected Fields:**
- metadata[0] = collector data
- metadata[0].data.photos = array with photo objects
- Each photo has: id, photoData, timestamp (if exists)

---

### Scenario 3: Synced Restaurant
**Expected Fields:**
- metadata[0] = restaurant metadata (because serverId exists)
- metadata[0].serverId = number
- metadata[0].sync.status = "synced"
- metadata[1] = collector data

---

### Scenario 4: Complete Restaurant
**Expected Fields:**
- All metadata sections present
- All curator categories with values
- All optional fields included
- No null values
- No empty arrays

---

## Success Criteria

### Data Integrity
- ✅ All restaurant data preserved
- ✅ No data loss from database
- ✅ Curator categories correctly grouped
- ✅ Photos included with proper encoding

### Format Compliance
- ✅ Metadata array is always present
- ✅ Metadata array has at least 1 item (collector data)
- ✅ Restaurant metadata only when needed
- ✅ Curator categories at root level
- ✅ No mandatory fields except restaurant name

### Output Quality
- ✅ Valid JSON
- ✅ No null values
- ✅ No empty arrays
- ✅ No empty objects
- ✅ Proper ISO 8601 timestamps
- ✅ Consistent structure across all restaurants

### Performance
- ✅ Export completes in < 5 seconds for 100 restaurants
- ✅ File size reasonable (no bloat)
- ✅ No memory issues

---

## Known Limitations (Phase 1)

1. **Michelin Data**: Not yet implemented (database schema needed)
2. **Google Places Data**: Not yet implemented (database schema needed)
3. **Modified Timestamp**: Database doesn't have `modifiedAt` field yet
4. **Import V2**: Not yet implemented (Phase 2)

---

## Next Steps

### After Testing
1. Fix any issues found
2. Add import support for V2 format
3. Add Michelin data storage to schema
4. Add Google Places data storage to schema
5. Update sync service for V2 format
6. Add format version detection
7. Backward compatibility testing

### Documentation
1. Update README with V2 format specification
2. Add migration guide
3. Add API documentation for V2 structure
4. Create example files
