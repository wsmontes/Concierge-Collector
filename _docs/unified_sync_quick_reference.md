# Unified Sync Button - Quick Reference

## What Changed?

**Old:** Two separate buttons
```
[Import from Server] [Export to Server]
```

**New:** One unified button
```
[🔄 Sync with Server]
```

---

## How It Works

1. **Import First** → Gets latest data from server
2. **Export Second** → Pushes local changes to server
3. **Auto-refresh** → Updates restaurant list

---

## User Actions

### To Sync
1. Click "Sync with Server"
2. Wait for progress messages (1/2, 2/2)
3. See success notification with timing

### Visual Feedback
- 🔄 Icon spins during sync
- Button disabled (can't double-click)
- Progress messages update
- Success notification shows total time

---

## For Developers

### New Method
```javascript
await exportImportModule.syncWithServer()
```

### Event Listener
```javascript
document.getElementById('sync-with-server')
  .addEventListener('click', handler)
```

### CSS Animation
```css
.syncing .material-icons {
    animation: spin 1s linear infinite;
}
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Import fails | Shows warning, continues with export |
| Export fails | Shows error, stops sync |
| Network down | Shows error, can retry |
| Both fail | Shows error, can retry |

---

## Testing

### Quick Test
1. Open browser console
2. Run: `_docs/verify_sync_button.js`
3. Click "Sync with Server"
4. Check console logs and notifications

### Console Output Example
```
🔄 Starting unified sync with server...
🔄 Step 1/2: Importing from server...
✅ Import completed successfully
🔄 Step 2/2: Exporting to server...
✅ Export completed successfully
✅ Unified sync completed in 3.45s
```

---

## Files Modified

- ✅ `index.html` - Button HTML
- ✅ `exportImportModule.js` - Sync logic
- ✅ `sync-badges.css` - Button animation

---

## Benefits

✅ **Simpler** - One click instead of two  
✅ **Smarter** - Optimal sync order  
✅ **Clearer** - Progress indication  
✅ **Safer** - Error handling  
✅ **Prettier** - Spinning icon

---

## Related Docs

- Full implementation: `_docs/unified_sync_implementation.md`
- Verification script: `_docs/verify_sync_button.js`
