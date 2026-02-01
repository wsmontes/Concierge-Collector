# Project Cleanup Plan - Concierge Collector

**Date:** January 31, 2026  
**Status:** Analysis Phase  
**Priority:** HIGH - Required before refactoring

---

## 📊 Current State

### Files Summary
```
JavaScript Files:     59 files
Documentation:       150 files
Investigation docs:   60 files (40% of total!)
Backup files:         3 files (.bak, .backup)
Legacy files:         2 files (scripts/legacy/)
```

### Size Analysis (Top 10 Largest Files)
```
144K    placesModule.js         ❌ TOO LARGE (3177 lines)
128K    dataStorage.js          ❌ TOO LARGE (needs review)
112K    recordingModule.js      ❌ TOO LARGE (2417 lines)
112K    conceptModule.js        ❌ TOO LARGE (2512 lines)
112K    conceptModule.js.backup ❌ DELETE (backup file)
 88K    exportImportModule.js   ⚠️ REVIEW (deprecated?)
 60K    dataStore.js            ✅ OK
 52K    safetyUtils.js          ⚠️ REVIEW (too large?)
 52K    curatorModule.js        ⚠️ REVIEW
 44K    placesModule.js.bak     ❌ DELETE (backup file)
```

---

## 🔍 Files Inventory

### Core Files (scripts/core/) - 7 files ✅ KEEP ALL
```
config.js                  ✅ Used in index.html (line 66)
logger.js                  ✅ Used in index.html (line 69)
main.js                    ✅ Used in index.html (line 788)
moduleWrapper.js           ✅ Used in index.html (line 701)
versionCheck.js            ✅ Used in index.html (line 22)
```

### Auth Files (scripts/auth/) - 3 files ✅ KEEP ALL
```
accessControl.js           ✅ Used in index.html (line 786)
auth.js                    ✅ Used in index.html (line 779)
curatorProfile.js          ✅ Used in index.html (line 782)
```

### Legacy Files (scripts/legacy/) - 2 files ❌ REVIEW
```
apiHandler.js              ❌ 13KB - CHECK if used anywhere
audioRecorder.js           ❌ 11KB - CHECK if used anywhere
```

**Action:** 
- Grep codebase for references
- If unused → Archive to archive/old-code/
- If used → Document why it's "legacy" but still used

---

### Managers (scripts/managers/) - 4 files ✅ KEEP ALL
```
errorManager.js            ✅ Used in index.html (line 708)
formManager.js             ✅ Used in index.html (line 709)
progressManager.js         ✅ Used in index.html (line 706)
stateStore.js              ✅ Used in index.html (line 705)
```

---

### Modules (scripts/modules/) - 18 files

#### ✅ KEEP (Used in index.html)
```
audioUtils.js              ✅ Line 775
conceptModule.js           ✅ Line 755 (2512 lines - NEEDS REFACTOR)
curatorModule.js           ✅ Line 751 (52KB - REVIEW SIZE)
draftRestaurantManager.js  ✅ Line 750
entityModule.js            ✅ Line 756
pendingAudioManager.js     ✅ Line 749
placesModule.js            ✅ Line 774 (3177 lines - NEEDS REFACTOR)
quickActionModule.js       ✅ Line 760
recordingModule.js         ✅ Line 752 (2417 lines - NEEDS REFACTOR)
safetyUtils.js             ✅ Line 747
syncStatusModule.js        ✅ Line 757
transcriptionModule.js     ✅ Line 753
uiUtilsModule.js           ✅ Line 748
```

#### ⚠️ REVIEW (Not in index.html)
```
exportImportModule.js      ⚠️ 88KB - Line 758 says DEPRECATED
                              - Check if any code references it
                              - If unused → Archive
```

#### ❌ DELETE (Backup files)
```
conceptModule.js.backup    ❌ 112KB backup (2519 lines)
placesModule.js.bak        ❌ 44KB backup (1020 lines)
conceptModule_fixes.txt    ❌ 8KB temporary notes
```

**Actions:**
1. Delete all .backup, .bak, _fixes.txt files
2. Check exportImportModule.js usage
3. Schedule refactoring for large modules

---

### Services (scripts/services/) - 13 files

#### ✅ KEEP (Used)
```
apiService.js              ✅ index.html line 723
conceptMatcher.js          ✅ index.html line 742
findEntityModal.js         ✅ index.html line 784
PlacesAutomation.js        ✅ index.html line 771
PlacesOrchestrationService.js ✅ index.html line 768
promptTemplate.js          ✅ index.html line 741
V3DataTransformer.js       ✅ index.html line 762
```

#### ✅ KEEP (Google Places Services)
```
googlePlaces/PlacesCache.js     ✅ index.html line 764
googlePlaces/PlacesFormatter.js ✅ index.html line 765
googlePlaces/PlacesService.js   ✅ index.html line 766
```

---

### Storage (scripts/storage/) - 3 files ✅ KEEP ALL
```
dataStorage.js             ✅ Used (128KB - NEEDS REVIEW)
dataStorageWrapper.js      ✅ index.html line 745
dataStore.js               ✅ index.html line 722 (60KB)
```

**Note:** dataStorage.js vs dataStore.js - Are both needed? Document difference.

---

### Sync (scripts/sync/) - 3 files ✅ KEEP ALL
```
importManager.js           ✅ index.html line 729
syncManagerV3.js           ✅ index.html line 728
syncSettingsManager.js     ✅ index.html line 791
```

---

### UI Core (scripts/ui-core/) - 11 files ✅ KEEP ALL
```
accessibilityChecker.js    ✅ index.html line 718
bottomSheet.js             ✅ index.html line 712
emptyStateManager.js       ✅ index.html line 717
gestureManager.js          ✅ index.html line 713
lazyLoader.js              ✅ index.html line 715
modalManager.js            ✅ index.html line 704
navigationManager.js       ✅ index.html line 707
optimisticUI.js            ✅ index.html line 716
skeletonLoader.js          ✅ index.html line 714
uiManager.js               ✅ Used (40KB)
uiUtils.js                 ✅ index.html line 700
```

---

### UI (scripts/ui/) - 2 files ✅ KEEP ALL
```
cardFactory.js             ✅ index.html line 732
conflictResolutionModal.js ✅ index.html line 733
```

---

### Utils (scripts/utils/) - 2 files
```
dbDiagnostics.js           ⚠️ NOT in index.html - CHECK usage
restaurantValidator.js     ✅ index.html line 109
```

---

### Root Level Scripts - 2 files ⚠️ INVESTIGATE
```
scripts/auth.js            ✅ index.html line 779
scripts/audioRecorder.js   ⚠️ index.html line 743 - BUT also in legacy/
scripts/curatorProfile.js  ✅ index.html line 782
scripts/uiManager.js       ⚠️ index.html line 744 - BUT also in ui-core/
```

**CRITICAL ISSUE:** Duplicate files!
- `audioRecorder.js` exists in root AND in `legacy/`
- `uiManager.js` exists in root AND in `ui-core/`

**Action:** Determine which is correct, delete duplicate

---

## 📚 Documentation Analysis

### Total: 150 markdown files

### Investigation/Fix Documents: 60 files (40%!)
```
INVESTIGATION*.md          Multiple files
*FIX*.md                   Multiple files
*SUMMARY*.md              Multiple files
*COMPLETE*.md             Multiple files
*RESOLVED*.md             Multiple files
*AUDIT*.md                Multiple files
```

### Archive Folder
```
docs/archive/              40+ files already archived
```

### Status
- ✅ **archive/** folder exists and is being used
- ⚠️ **60 investigation docs** outside archive (need review)
- ⚠️ Many docs dated 2025 (last year) - candidates for archiving

---

## 🎯 Cleanup Plan

### Phase 1: Delete Obvious Cruft (30 min)

#### 1.1 Backup Files ❌ DELETE
```bash
rm scripts/modules/conceptModule.js.backup
rm scripts/modules/placesModule.js.bak
rm scripts/modules/conceptModule_fixes.txt
```

#### 1.2 Verify No References
```bash
# Check if backup files are referenced anywhere
grep -r "conceptModule.js.backup" .
grep -r "placesModule.js.bak" .
grep -r "conceptModule_fixes.txt" .
```

**Expected:** No matches → Safe to delete

---

### Phase 2: Resolve Duplicates (1 hour)

#### 2.1 audioRecorder.js Duplicate
```bash
# Compare files
diff scripts/audioRecorder.js scripts/legacy/audioRecorder.js

# Determine which is correct
# If root is used, archive legacy
# If legacy is used, fix index.html reference
```

#### 2.2 uiManager.js Duplicate
```bash
# Compare files
diff scripts/uiManager.js scripts/ui-core/uiManager.js

# Determine which is correct
# Update index.html to use correct one
# Archive/delete the wrong one
```

#### 2.3 auth.js and curatorProfile.js Location
```bash
# Should these be in scripts/auth/?
# Currently in root scripts/

# Option A: Move to scripts/auth/
mv scripts/auth.js scripts/auth/
mv scripts/curatorProfile.js scripts/auth/
# Update index.html paths

# Option B: Leave as-is, document why
```

---

### Phase 3: Legacy Folder Review (30 min)

#### 3.1 Check Usage
```bash
# Search for references
grep -r "legacy/apiHandler" .
grep -r "legacy/audioRecorder" .
```

#### 3.2 Decision
- If UNUSED → Move to archive/old-code/
- If USED → Document WHY it's still needed
- If USED → Plan migration to remove dependency

---

### Phase 4: Unused Files (1 hour)

#### 4.1 exportImportModule.js
```bash
# Check if used despite "DEPRECATED" comment
grep -r "exportImportModule" . --exclude-dir=node_modules
```

#### 4.2 dbDiagnostics.js
```bash
# Check if used
grep -r "dbDiagnostics" . --exclude-dir=node_modules
```

#### 4.3 Actions
- If unused → Move to archive/old-code/
- If used → Remove "DEPRECATED" comment
- Document in cleanup summary

---

### Phase 5: Documentation Cleanup (2 hours)

#### 5.1 Identify Old Investigation Docs
```bash
# Find investigation docs older than 3 months
find docs -name "*INVESTIGATION*.md" -o -name "*FIX*.md" -o -name "*SUMMARY*.md" \
| xargs ls -lt \
| tail -40
```

#### 5.2 Archive Rules
**Archive if:**
- ✅ Issue is RESOLVED
- ✅ Dated more than 3 months ago
- ✅ Superseded by newer documentation
- ✅ Contains "COMPLETE" or "RESOLVED" in title

**Keep if:**
- ❌ Active investigation
- ❌ Current architecture documentation
- ❌ Contains relevant patterns/examples

#### 5.3 Create Archive Index
```bash
# Update docs/archive/INDEX.md
# Add summaries of archived docs
# Link to new active docs if relevant
```

---

### Phase 6: Storage Layer Clarification (30 min)

#### 6.1 Document Differences
```
dataStorage.js (128KB)     → Legacy storage layer?
dataStore.js (60KB)        → V3 storage layer?
dataStorageWrapper.js (4KB) → Compatibility layer?
```

#### 6.2 Actions
- Read file headers
- Document purpose of each
- Determine if both are needed
- Plan consolidation if redundant

---

## 📋 Execution Checklist

### Pre-Cleanup
- [ ] Create backup branch: `git checkout -b cleanup-2026-01-31`
- [ ] Commit current state: `git commit -am "Pre-cleanup checkpoint"`
- [ ] Document plan approval

### Phase 1: Delete Backup Files
- [ ] Delete conceptModule.js.backup
- [ ] Delete placesModule.js.bak
- [ ] Delete conceptModule_fixes.txt
- [ ] Test application loads
- [ ] Commit: "Remove backup files"

### Phase 2: Resolve Duplicates
- [ ] Compare audioRecorder.js files
- [ ] Resolve audioRecorder.js duplicate
- [ ] Compare uiManager.js files
- [ ] Resolve uiManager.js duplicate
- [ ] Test application loads
- [ ] Commit: "Resolve duplicate files"

### Phase 3: Legacy Review
- [ ] Check legacy/apiHandler.js usage
- [ ] Check legacy/audioRecorder.js usage
- [ ] Archive or document
- [ ] Update references if needed
- [ ] Test application loads
- [ ] Commit: "Clean up legacy folder"

### Phase 4: Unused Files
- [ ] Check exportImportModule.js usage
- [ ] Check dbDiagnostics.js usage
- [ ] Archive unused files
- [ ] Remove from index.html if needed
- [ ] Test application loads
- [ ] Commit: "Archive unused files"

### Phase 5: Documentation
- [ ] Identify old investigation docs
- [ ] Move to docs/archive/
- [ ] Update archive/INDEX.md
- [ ] Commit: "Archive old documentation"

### Phase 6: Storage Clarification
- [ ] Document dataStorage.js purpose
- [ ] Document dataStore.js purpose
- [ ] Document dataStorageWrapper.js purpose
- [ ] Update architecture docs
- [ ] Commit: "Document storage layer"

### Post-Cleanup
- [ ] Full application test
- [ ] Check all features work
- [ ] Verify no console errors
- [ ] Merge to main: `git checkout main && git merge cleanup-2026-01-31`
- [ ] Push: `git push origin main`
- [ ] Delete branch: `git branch -d cleanup-2026-01-31`

---

## 📊 Expected Results

### Before Cleanup
```
JavaScript files:     59
Backup files:         3
Legacy uncertain:     2
Documentation:        150 (60 investigations)
Duplicate files:      4
```

### After Cleanup
```
JavaScript files:     ~54 (delete 5)
Backup files:         0
Legacy uncertain:     0 (documented or archived)
Documentation:        ~90 active, 60 archived
Duplicate files:      0
```

### Benefits
- ✅ Clearer codebase structure
- ✅ Easier to find files
- ✅ No confusion about which file to edit
- ✅ Documented legacy dependencies
- ✅ Ready for refactoring

---

## 🚨 Risk Mitigation

### Backup Strategy
1. Create cleanup branch before any changes
2. Commit after each phase
3. Test application after each phase
4. Keep branch for 30 days after merge

### Rollback Plan
```bash
# If issues found after cleanup
git revert <commit-hash>

# Or restore entire cleanup
git reset --hard <pre-cleanup-commit>
```

### Testing Checklist
After each phase, verify:
- [ ] Application loads without errors
- [ ] Can record audio
- [ ] Can extract concepts
- [ ] Can save restaurant
- [ ] Can view restaurant list
- [ ] Can sync data

---

## 📝 Next Steps

1. **Review this plan** with team/lead developer
2. **Schedule cleanup** - Estimated 5-6 hours total
3. **Execute phases** one at a time
4. **Document findings** during cleanup
5. **Proceed to refactoring** (Priority 2 from audit)

---

## 📚 Related Documents
- [CODE_QUALITY_AUDIT_2026_01_31.md](CODE_QUALITY_AUDIT_2026_01_31.md) - Refactoring roadmap
- [COLLECTOR_V3_ARCHITECTURE.md](COLLECTOR_V3_ARCHITECTURE.md) - Target architecture
- [COLLECTOR_MODERNIZATION_PLAN.md](COLLECTOR_MODERNIZATION_PLAN.md) - Modernization goals

---

**Document Status:** READY FOR EXECUTION  
**Estimated Time:** 5-6 hours  
**Priority:** HIGH - Blocking refactoring work  
**Owner:** Development Team
