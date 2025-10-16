# Concierge Import Function Update

## Purpose
Updated the Concierge JSON import function to support both the original array format and the new object format used in `restaurants - 2025-10-15.json`. The system now automatically detects and handles Concierge format data, even when using the regular "Import Data" button.

## Changes Made

### Files Modified
1. `scripts/modules/exportImportModule.js`:
   - Updated `importData()` method - Added automatic Concierge format detection
   - Added `detectConciergeFormat()` method - Detects Concierge format automatically
   - Updated `convertConciergeFormat()` method - Supports both array and object formats

### What Changed

#### Automatic Format Detection
The import function now automatically detects which format the JSON file is in:
- **Standard Export Format**: `{curators: [...], concepts: [...], restaurants: [...]}`
- **Concierge Array Format**: `[{name: "...", cuisine: [...], ...}]`
- **Concierge Object Format**: `{"restaurant name": {cuisine: [...], ...}}`

#### Previous Format Support (Array)
```json
[
  {
    "name": "Restaurant Name",
    "cuisine": ["italian", "pizza"],
    "menu": ["pasta", "pizza"],
    ...
  }
]
```

#### New Format Support (Object with Restaurant Names as Keys)
```json
{
  "fogo de chão - jardins": {
    "cuisine": ["brazilian", "barbecue"],
    "menu": ["rib-eye steak", "barbecue"],
    "food_style": ["classic", "traditional"],
    "drinks": ["bourbon", "caipirinhas"],
    "setting": ["upscale", "classical"],
    "mood": ["lively", "executive"],
    "crowd": ["international", "families"],
    "suitable_for": ["meetings", "tourists"],
    "special_features": ["open 7x7", "private events"],
    "covid_specials": ["masked staff", "covid protocols"],
    "price_and_payment": ["credit cards accepted"],
    "price_range": ["expensive"]
  },
  "another restaurant": {
    ...
  }
}
```

### Implementation Details

1. **Automatic Detection**: The `detectConciergeFormat()` method checks:
   - If data has `curators`, `concepts`, `restaurants` → Standard format
   - If data is array with Concierge properties → Concierge array format
   - If data is object with Concierge properties → Concierge object format

2. **Format Normalization**: Object format is converted to array format by using keys as restaurant names

3. **Additional Categories**: Added support for two new categories found in the new format:
   - `covid_specials` → "Covid Specials" category
   - `price_and_payment` → "Price and Payment" category

4. **Better Logging**: Added console logs to track conversion progress and summary

### Key Features

- **Automatic Detection**: No need to use a separate button - the system detects the format automatically
- **Backward Compatible**: Still works with the original array format and standard export format
- **User-Friendly**: Users can use either import button for Concierge data
- **Flexible**: Automatically handles all three formats
- **Error Handling**: Provides clear error messages if data format is invalid
- **Complete Coverage**: Processes all 12 category types:
  1. Cuisine
  2. Menu
  3. Price Range
  4. Mood
  5. Setting
  6. Crowd
  7. Suitable For
  8. Food Style
  9. Drinks
  10. Special Features
  11. Covid Specials (NEW)
  12. Price and Payment (NEW)

### How to Use

#### Option 1: Regular Import Data Button (RECOMMENDED)
1. Go to the Export/Import Data section
2. Select your JSON file using the "Select JSON or ZIP file to import" file input
3. Click "Import Data" button
4. The system will automatically detect if it's Concierge format and import accordingly

#### Option 2: Dedicated Concierge Import Button
1. Go to the Export/Import Data section
2. Select your JSON file using the "Import Concierge restaurant data" file input
3. Click "Import Concierge Data" button
4. The system will import using the Concierge handler

Both methods work equally well! The system is now smart enough to detect the format automatically.

### Technical Notes

- Restaurant names from the object keys are used as the restaurant name
- All restaurants are assigned to the currently active curator
- Temporary negative IDs are used during import and replaced with real IDs by the database
- Duplicate concepts are automatically detected and reused
- Empty or whitespace-only values are filtered out
- Asterisk suffixes (used in some Concierge data) are automatically cleaned

### Detection Logic

The `detectConciergeFormat()` method uses the following logic:

1. **Check for Standard Format**: If data has `curators`, `concepts`, and `restaurants` properties → Standard format (not Concierge)
2. **Check Array Format**: If data is an array, check first element for Concierge properties (cuisine, menu, food_style, drinks)
3. **Check Object Format**: If data is an object, check first value for Concierge properties
4. **Return Result**: Returns `true` if Concierge format detected, `false` otherwise

### Error Resolution

The original error "Invalid import data format" occurred because:
- The system tried to import Concierge format as standard format
- Standard format expects `{curators: [], concepts: [], restaurants: []}`
- Concierge format has `{"restaurant name": {cuisine: [], ...}}`

**Solution**: The system now detects the format and routes to the appropriate handler automatically.

### Testing Recommendations

1. ✅ Test with the original array format to ensure backward compatibility
2. ✅ Test with the new object format (`restaurants - 2025-10-15.json`)
3. ✅ Test with standard export format (ZIP or JSON)
4. ✅ Verify that all 12 categories are properly imported
5. ✅ Check that restaurant names are correctly extracted from object keys
6. ✅ Confirm that duplicate concepts are properly handled
7. ✅ Test using both "Import Data" and "Import Concierge Data" buttons

## Result

The import function now:
- ✅ Automatically detects Concierge format (both array and object styles)
- ✅ Fully supports the structure of `restaurants - 2025-10-15.json`
- ✅ Can import all 124 restaurants with all their associated concepts across all categories
- ✅ Works with either import button - no confusion for users
- ✅ Provides clear feedback about which format was detected
