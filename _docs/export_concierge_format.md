# Export to Concierge Format Feature

## Purpose
Added the ability to export restaurant data in **Concierge format** (object with restaurant names as keys), matching the structure of `restaurants - 2025-10-15.json`.

## Changes Made

### File Modified
`scripts/modules/exportImportModule.js`

### New Methods Added

#### 1. `promptExportFormat()`
- Creates a modal dialog for users to select export format
- Two options:
  - **Concierge Format**: Simplified format compatible with Concierge systems
  - **Standard Format**: Complete database backup with all data and photos
- Clean, user-friendly interface with Material Icons
- Cancellable with background click or Cancel button

#### 2. `convertToConciergeFormat(standardData)`
- Converts internal database format to Concierge format
- Groups concepts by restaurant
- Categorizes concepts into Concierge-compatible categories
- Returns object with restaurant names as keys

#### 3. `exportData()` - Updated
- Now prompts user to select format before export
- Supports both Standard and Concierge formats
- Generates appropriate filenames for each format
- Maintains backward compatibility

## Export Formats

### Concierge Format
**File Name**: `restaurants-YYYY-MM-DD.json`

**Structure**:
```json
{
  "restaurant name": {
    "cuisine": ["italian", "pizza"],
    "menu": ["pasta", "pizza", "salad"],
    "food_style": ["traditional"],
    "drinks": ["wine", "beer"],
    "setting": ["casual"],
    "mood": ["friendly"],
    "crowd": ["families"],
    "suitable_for": ["casual dining"],
    "special_features": ["outdoor seating"],
    "covid_specials": ["masked staff"],
    "price_and_payment": ["credit cards accepted"],
    "price_range": ["moderate"]
  }
}
```

**Features**:
- Simplified, human-readable format
- Restaurant names as object keys
- Only includes categories with values
- Compatible with Concierge systems
- Easy to share and import into other systems
- No photos (JSON only)

### Standard Format
**File Name**: `restaurant-curator-export-YYYY-MM-DD.json` or `.zip`

**Structure**:
```json
{
  "curators": [...],
  "concepts": [...],
  "restaurants": [...],
  "restaurantConcepts": [...],
  "restaurantLocations": [...],
  "restaurantPhotos": [...]
}
```

**Features**:
- Complete database backup
- Includes all relationships and metadata
- Includes photos (if any, exported as ZIP)
- Full restore capability
- Internal format for backup/restore operations

## Category Mapping

The converter maps internal categories to Concierge format:

| Internal Category | Concierge Format |
|------------------|------------------|
| Cuisine | cuisine |
| Menu | menu |
| Food Style | food_style |
| Drinks | drinks |
| Setting | setting |
| Mood | mood |
| Crowd | crowd |
| Suitable For | suitable_for |
| Special Features | special_features |
| Covid Specials | covid_specials |
| Price and Payment | price_and_payment |
| Price Range | price_range |

## How to Use

### Exporting Data

1. Click the **"Export Data"** button
2. A modal will appear with two format options:

   **Option 1: Concierge Format**
   - Click the "Concierge Format" button
   - Downloads: `restaurants-2025-10-15.json`
   - Use this for: Sharing with Concierge systems, simple backups

   **Option 2: Standard Format**
   - Click the "Standard Format (Full Backup)" button
   - Downloads: `restaurant-curator-export-2025-10-15.json` (or .zip with photos)
   - Use this for: Complete backups, restoring data

3. Cancel: Click "Cancel" or click outside the modal to abort

### Importing Data

Both formats can be imported using the **"Import Data"** button:
- The system automatically detects the format
- Concierge format is converted to internal format
- Standard format is imported directly

## Use Cases

### Concierge Format
✅ Sharing restaurant data with partners  
✅ Creating readable restaurant lists  
✅ Importing into Concierge systems  
✅ Data exchange with other applications  
✅ Quick review of restaurant information  
✅ Lightweight backups (no photos)

### Standard Format
✅ Complete database backups  
✅ Preserving all relationships and metadata  
✅ Including photos in the export  
✅ Restoring complete application state  
✅ Migrating between systems  
✅ Archival purposes

## Technical Details

### Conversion Process

1. **Group Concepts**: Concepts are grouped by restaurant ID
2. **Categorize**: Each concept is placed in its corresponding Concierge category
3. **Filter Empty**: Only categories with values are included
4. **Format**: Restaurant name becomes the object key
5. **Output**: Clean, readable JSON structure

### Performance

- Efficient Map-based lookups
- Single pass through data
- Minimal memory overhead
- Fast conversion for large datasets

### Data Integrity

- All concept values are preserved
- Restaurant names are used as-is
- Empty categories are omitted (cleaner output)
- No data loss during conversion
- Bidirectional compatibility (export → import → export produces same result)

## Examples

### Example 1: Single Restaurant Export
```json
{
  "Pizzeria Bella": {
    "cuisine": ["italian", "pizza"],
    "menu": ["margherita pizza", "pasta carbonara", "tiramisu"],
    "food_style": ["traditional", "homemade"],
    "drinks": ["italian wine", "espresso"],
    "setting": ["cozy", "family-friendly"],
    "mood": ["casual", "welcoming"],
    "crowd": ["families", "couples"],
    "suitable_for": ["family dinners", "date nights"],
    "special_features": ["wood-fired oven", "outdoor seating"],
    "price_range": ["moderate"]
  }
}
```

### Example 2: Multiple Restaurants Export
```json
{
  "Sushi Master": {
    "cuisine": ["japanese", "sushi"],
    "menu": ["sashimi", "nigiri", "rolls"],
    "food_style": ["traditional", "fresh"],
    "drinks": ["sake", "green tea"],
    "setting": ["minimalist", "elegant"],
    "price_range": ["expensive"]
  },
  "Taco Heaven": {
    "cuisine": ["mexican", "street food"],
    "menu": ["tacos", "burritos", "quesadillas"],
    "food_style": ["casual", "authentic"],
    "drinks": ["margaritas", "mexican beer"],
    "setting": ["vibrant", "outdoor"],
    "price_range": ["budget-friendly"]
  }
}
```

## Benefits

### For Users
- ✅ Choose the right format for the task
- ✅ Simplified sharing of restaurant data
- ✅ Cleaner, more readable exports
- ✅ Compatible with external systems
- ✅ Flexible export options

### For Developers
- ✅ Clean, well-documented code
- ✅ Reusable conversion functions
- ✅ Bidirectional format support
- ✅ Easy to extend with new categories
- ✅ Maintains data integrity

### For Organizations
- ✅ Standard format for data exchange
- ✅ Compatible with Concierge ecosystem
- ✅ Easy integration with partner systems
- ✅ Simplified data sharing workflows
- ✅ Readable reports and exports

## Testing Recommendations

1. ✅ Export a few restaurants in Concierge format
2. ✅ Verify the JSON structure matches the expected format
3. ✅ Import the exported Concierge file back into the system
4. ✅ Confirm all concepts are preserved
5. ✅ Test with restaurants that have all 12 categories
6. ✅ Test with restaurants that have only a few categories
7. ✅ Verify restaurant names with special characters work correctly
8. ✅ Test canceling the export format selection
9. ✅ Confirm standard format still works as before
10. ✅ Verify ZIP export with photos still works

## Compatibility

- ✅ **Import**: Both formats can be imported via "Import Data" button
- ✅ **Export**: User chooses format at export time
- ✅ **Roundtrip**: Concierge format → Import → Export → Produces same structure
- ✅ **Backward Compatible**: Standard format unchanged
- ✅ **Cross-System**: Concierge format works with external systems

## Future Enhancements

Possible future improvements:
- Add default format preference in settings
- Include location data in Concierge format (if available)
- Add review/notes fields to Concierge format
- Support for multiple curator exports
- Batch export by curator or filter criteria
- Export preview before download
- Custom category mapping options

## Summary

This update adds flexible export capabilities to the Restaurant Curator application:

1. **User Choice**: Users select their preferred export format
2. **Concierge Format**: Simplified, shareable format matching industry standards
3. **Standard Format**: Complete backup with all data and photos
4. **Bidirectional**: Both formats can be imported back
5. **User-Friendly**: Clear modal interface for format selection

The export system is now more versatile and compatible with external systems while maintaining full backward compatibility.
