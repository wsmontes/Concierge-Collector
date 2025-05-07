# Concierge Collector Import Specification

## Overview

This document provides a detailed specification for importing data exported from the Concierge Collector application. It covers the format of exported files, data structures, validation requirements, and implementation guidelines for developing import functionality in companion applications like the Restaurant Editor.

## Export File Formats

The Concierge Collector provides two export formats:

1. **JSON Format**: A single JSON file containing all data except binary image data
2. **ZIP Archive**: Contains a JSON data file plus image files referenced by the data

## Data Structure

### JSON Data Schema

The exported JSON file contains the following structure:

```json
{
  "curators": [
    {
      "id": number,
      "name": string,
      "lastActive": string (ISO date)
    }
  ],
  "concepts": [
    {
      "id": number,
      "category": string,
      "value": string,
      "timestamp": string (ISO date)
    }
  ],
  "restaurants": [
    {
      "id": number,
      "name": string,
      "curatorId": number,
      "timestamp": string (ISO date),
      "transcription": string | null,
      "description": string | null
    }
  ],
  "restaurantConcepts": [
    {
      "id": number,
      "restaurantId": number,
      "conceptId": number
    }
  ],
  "restaurantLocations": [
    {
      "id": number,
      "restaurantId": number,
      "latitude": number,
      "longitude": number,
      "address": string | null
    }
  ],
  "restaurantPhotos": [
    {
      "id": number,
      "restaurantId": number,
      "photoDataRef": string  // Reference to image file in ZIP archive
    }
  ]
}
```

### ZIP Archive Structure

When exported as a ZIP file, the archive contains:

- `data.json`: The JSON data with the structure described above
- `images/` directory containing photo files:
  - Photos are stored as `images/photo_{id}.jpg` where `{id}` corresponds to the original photo ID
  - Each photo in the `restaurantPhotos` array has a `photoDataRef` property pointing to its file path in the ZIP

## Import Process

### Validation Requirements

Before importing, the system should validate:

1. **Schema conformance**: Verify the JSON structure matches the expected schema
2. **Data integrity**:
   - All referenced IDs exist (e.g., each restaurantConcept's conceptId maps to an existing concept)
   - Required fields are present and non-null (name, category, value, etc.)
   - Data types match the expected format (numbers, strings, dates)
3. **Image references**: When importing from ZIP, verify all referenced images exist

### Import Steps

1. **Parse JSON**:
   - Parse the JSON file or extract and parse from ZIP
   - Validate the overall structure matches expected schema

2. **Validate relationships**:
   - Ensure all foreign key references are valid
   - Check for orphaned records

3. **ID Mapping**:
   - Create a mapping of original IDs to new system IDs
   - This is crucial since IDs in the importing system will differ from the exported ones

4. **Import Data in Dependency Order**:
   1. Import curators first
   2. Import concepts next
   3. Import restaurants
   4. Import relationships (restaurantConcepts)
   5. Import locations
   6. Import photo references and load photo data

5. **Handle duplicates**:
   - For concepts, check if a concept with the same category+value already exists
   - If yes, use the existing concept ID in the import mapping
   - Apply similar logic to avoid duplicating other entities when appropriate

### Image Handling

For ZIP imports:

1. Extract the `data.json` file and parse it
2. For each entry in `restaurantPhotos`:
   - Locate the referenced image file in the ZIP
   - Extract and store the image in the target system
   - Update the reference in the imported data to point to the new storage location

## Error Handling

The import system should:

1. **Use transactions** where possible to ensure all-or-nothing imports
2. **Provide detailed error messages** if validation fails
3. **Support partial recovery** for non-critical errors
4. **Log all issues** with specific record references for later debugging

## Data Mapping Considerations

When importing into a different system:

1. **Schema compatibility**: Map fields from the export schema to the target schema
2. **ID regeneration**: Generate new IDs appropriate for the target system
3. **Relationships preservation**: Maintain all relationship integrity using ID mapping tables
4. **Metadata handling**: Preserve metadata like timestamps when possible

## Advanced Import Features

### Conflict Resolution

The import system should provide options for conflict resolution when importing data that might conflict with existing records:

1. **Skip existing**: Skip importing records that already exist
2. **Replace existing**: Replace existing records with imported ones
3. **Merge**: Intelligently merge data from both sources
4. **Mark conflicted**: Import but flag records with conflicts for manual review

### Batch Importing

For importing multiple export files:

1. Use a consistent approach for handling ID conflicts across files
2. Provide progress tracking for long-running imports
3. Support resuming failed imports

## Implementation Guidelines

### Performance Considerations

1. **Memory efficiency**: Process large collections in chunks to avoid memory issues
2. **Progress reporting**: For large imports, provide progress updates
3. **Batch processing**: Group database operations in batches for improved performance

### Security Considerations

1. **Validate all inputs**: Treat the import file as untrusted data
2. **Sanitize content**: Especially text fields that might contain scripts
3. **Resource limits**: Implement timeouts and size limits to prevent DoS conditions

## Testing Requirements

Import functionality should be tested with:

1. Valid export files from recent versions of Concierge Collector
2. Intentionally malformed files to verify validation
3. Very large datasets to ensure performance
4. Files with missing images to test error handling
5. Files from different versions of Concierge Collector to ensure backward compatibility

## Example Import Pseudo-code

```javascript
async function importFromCollector(file) {
  // Determine if it's a JSON or ZIP file
  const importData = await extractData(file);
  
  // Validate schema
  validateSchema(importData);
  
  // Begin transaction
  const transaction = await db.beginTransaction();
  
  try {
    // Create ID mappings
    const curatorMap = new Map();
    const conceptMap = new Map();
    const restaurantMap = new Map();
    
    // Import curators
    for (const curator of importData.curators) {
      const newId = await importCurator(curator);
      curatorMap.set(curator.id, newId);
    }
    
    // Import concepts (checking for duplicates)
    for (const concept of importData.concepts) {
      const newId = await importConcept(concept);
      conceptMap.set(concept.id, newId);
    }
    
    // Continue with restaurants, relationships, etc.
    // ...
    
    // Commit transaction
    await transaction.commit();
    return { success: true };
  } catch (error) {
    // Rollback on error
    await transaction.rollback();
    return { 
      success: false, 
      error: error.message 
    };
  }
}
```

## Backward Compatibility

The import functionality should be designed to handle:

1. Older export formats from previous versions of Concierge Collector
2. Future export formats by using a flexible schema validation
3. Missing optional fields that might be added in future versions

## Common Issues and Solutions

| Issue | Detection | Solution |
|-------|-----------|----------|
| Invalid JSON | JSON parse error | Show specific parse error and line number |
| Missing required fields | Schema validation | List all missing fields |
| Invalid relationships | ID reference check | List orphaned references |
| Duplicate entries | Uniqueness check | Provide conflict resolution options |
| Missing images | File existence check | Continue with warning or offer placeholder |
| Version incompatibility | Schema version check | Provide upgrade path or converter |
| Large file performance | Monitor memory/time | Implement streaming processing |