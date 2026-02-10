# Database Management System - Robust IndexedDB

## Overview

The new database management system provides a robust, self-healing approach to IndexedDB that eliminates common issues with schema changes and data corruption.

## Architecture

### Components

1. **DatabaseManager** (`scripts/storage/databaseManager.js`)
   - Handles database versioning and migrations
   - Detects and repairs data inconsistencies
   - Provides automatic recovery from corruption
   - Implements backup/restore functionality

2. **DatabaseDiagnostics** (`scripts/storage/databaseDiagnostics.js`)
   - Console utilities for inspection and debugging
   - Exposes `DB.*` commands for developers
   - Provides export/import capabilities

3. **DataStore** (`scripts/storage/dataStore.js`)
   - Updated to use DatabaseManager
   - Maintains backward compatibility
   - Falls back to manual initialization if needed

## Key Features

### 1. Automatic Migrations

When the database schema changes, migrations run automatically:

```javascript
// Migration 1→2: Add metadata array to entities
this.migrations.set(1, async (db) => {
    const entities = await db.entities.toArray();
    for (const entity of entities) {
        if (!entity.metadata) {
            await db.entities.update(entity.entity_id, {
                metadata: []
            });
        }
    }
});
```

### 2. Data Validation

Every read operation validates data structure:

- Detects empty objects that shouldn't exist
- Checks for fields in wrong locations
- Identifies missing required fields
- Finds orphaned curations
- Locates duplicate entities

### 3. Automatic Repair

Common issues are automatically fixed:

- Empty `location`, `contacts`, `attributes` objects removed
- Photos moved from `data.photos` → `data.media.photos`
- Missing `metadata` arrays added
- Missing `version` fields added
- Duplicates removed (keeps most recent)

### 4. Recovery System

If initialization fails, the system attempts recovery:

1. **Backup Restore** - Restores from last known good state
2. **Nuclear Option** - Deletes and recreates database, triggers resync

### 5. Version Tracking

Database version is stored separately from Dexie versions:

- `_meta` table tracks custom version number
- Migrations are version-based (not Dexie version)
- Can detect legacy databases and upgrade them

## Console Commands

Access powerful debugging tools via the browser console:

### Status & Health

```javascript
DB.status()      // Show database health and statistics
DB.version()     // Show version information
```

### Validation & Repair

```javascript
DB.validate()    // Run full validation (non-destructive)
DB.repair()      // Attempt to fix all issues (creates backup first)
```

### Data Inspection

```javascript
DB.entities()    // List all entities as a table
DB.curations()   // List all curations as a table
DB.duplicates()  // Find duplicate entities
DB.orphans()     // Find orphaned curations
```

### Maintenance

```javascript
DB.export()      // Export database to JSON file
DB.clear()       // Clear and resync from server
```

## Example Output

```javascript
> DB.status()

📊 Database Status
  Version: 91
  Schema: v3.0-clean-break
  Entities: 145
  Curations: 289
  Sync Queue: 3
  ✅ No obvious issues
```

## Migration Guide

### Adding a New Migration

When you need to change the schema:

1. **Update DatabaseManager version**:
```javascript
this.currentVersion = 92; // Increment from 91
```

2. **Add migration**:
```javascript
this.migrations.set(91, async (db) => {
    // Your migration code here
    // Example: Add a new field
    const entities = await db.entities.toArray();
    for (const entity of entities) {
        await db.entities.update(entity.entity_id, {
            newField: 'default_value'
        });
    }
});
```

3. **Update schema definition** in `createFreshDatabase()` and `openDatabase()`

4. **Test migration**:
```javascript
// In console
DB.version()  // Check current version
// Reload page - migration runs automatically
DB.validate() // Check for issues
```

### Adding a New Validator

If you add new data structures that need validation:

```javascript
this.validators.set('my_entity', (entity) => {
    const issues = [];
    
    if (!entity.requiredField) {
        issues.push('Missing requiredField');
    }
    
    // Add more checks...
    
    return issues;
});
```

## Benefits

### Before (Old System)

❌ Schema changes broke existing databases
❌ Required manual localStorage clearing
❌ Lost data on version mismatch
❌ No way to detect/fix corruption
❌ Duplicate entries caused UI bugs

### After (New System)

✅ Schema changes migrate automatically
✅ Detects and repairs common issues
✅ Backup before destructive operations
✅ Recovery from corruption
✅ Duplicates detected and removed
✅ Console tools for debugging
✅ Version tracking across updates

## Error Handling

The system handles errors gracefully:

1. **Initialization Error** → Attempts recovery → Falls back to fresh database
2. **Migration Error** → Restores from backup → Reports specific failure
3. **Validation Error** → Logs issues → Continues operation (non-blocking)
4. **Repair Error** → Logs failure → Manual intervention required

## Performance

- Validation runs on startup (async, non-blocking)
- Migrations run once per version change
- Backups stored in localStorage (cleaned automatically)
- Minimal overhead during normal operations

## Future Enhancements

Potential improvements:

1. **Cloud Backup** - Store backups on server
2. **Migration History** - Track which migrations ran when
3. **Rollback Capability** - Undo specific migrations
4. **Real-time Validation** - Validate on write, not just read
5. **Health Metrics** - Track database health over time
6. **Auto-sync Triggers** - Smart resync when corruption detected

## Troubleshooting

### Database won't initialize

```javascript
// Check status
DB.status()

// Try repair
DB.repair()

// Nuclear option (loses local data)
DB.clear()
```

### Data looks wrong

```javascript
// Run validation
DB.validate()

// Check for specific issues
DB.duplicates()
DB.orphans()

// Export for analysis
DB.export()
```

### Migration failed

Check console for error message. Common causes:

- Network interruption during sync
- Invalid data in database
- Browser storage quota exceeded

Solution:
```javascript
// Restore from backup
DB.clear() // Will trigger resync
```

## Technical Details

### Version Number Strategy

- **Version 91**: Current production version (DataStore version)
- **Version 92+**: Future migrations
- **Legacy**: Databases without _meta table

### Schema Compatibility

The system maintains compatibility with:

- Dexie.js native versioning
- Existing DataStore schema (version 91)
- Legacy databases (pre-DatabaseManager)

### Migration Execution

Migrations run sequentially:

```
v89 → v90 → v91 → v92
```

Each migration is idempotent - safe to run multiple times.

### Backup Strategy

- Stored in `localStorage` as JSON
- Max 1 backup at a time (overwrites previous)
- Cleaned on successful migration
- Restored automatically on failure

## Best Practices

1. **Always test migrations** on a copy of production data
2. **Use DB.validate()** before and after schema changes
3. **Export database** before major operations
4. **Increment version** whenever schema changes
5. **Write idempotent migrations** (safe to run twice)
6. **Check console** for migration logs
7. **Monitor health** with periodic `DB.status()` calls

## Summary

The new database management system provides:

- 🛡️  **Robustness** - Handles schema changes gracefully
- 🔧 **Self-healing** - Detects and repairs issues automatically
- 📊 **Visibility** - Console tools for inspection
- 🔄 **Recovery** - Backup/restore capabilities
- 🚀 **Performance** - Minimal overhead
- 🎯 **Reliability** - Production-tested migrations

No more manual IndexedDB clearing. No more lost data. Just works.
