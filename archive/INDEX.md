# Archive Index

**Last Updated:** November 18, 2025  
**Purpose:** Track obsolete code and documentation archived during V3 migration

---

## 📋 Overview

This directory contains code and documentation that is no longer used in the V3 architecture. Files are preserved for historical reference but are not part of the active codebase.

---

## 📁 Archived Files

### old-api-docs/

Documentation for obsolete API integrations (pre-V3).

| File | Original Location | Archived Date | Reason |
|------|------------------|---------------|--------|
| `API_INTEGRATION_COMPLETE.md` | `docs/` | 2025-11-18 | Legacy API documentation (pythonanywhere) - replaced by API_V3_INTEGRATION_SPEC.md |
| `API_DOCUMENTATION_INDEX.md` | `docs/` | 2025-11-18 | Index for old API docs - no longer relevant |
| `API_RECOMMENDATIONS.md` | `docs/` | 2025-11-18 | Recommendations for old API - V3 uses different architecture |

**Context:**  
These documents described integration with the old Flask API hosted on pythonanywhere. The V3 architecture uses FastAPI with MongoDB, completely different endpoints, authentication (X-API-Key vs JWT), and data structures (Entity-Curation model).

**Replacement Documentation:**
- [API V3 Integration Spec](../docs/API_V3_INTEGRATION_SPEC.md)
- [Collector V3 Architecture](../docs/COLLECTOR_V3_ARCHITECTURE.md)
- [API V3 README](../concierge-api-v3/README.md)

---

### old-code/

Code modules that are no longer functional or relevant.

| File | Original Location | Archived Date | Reason |
|------|------------------|---------------|--------|
| `syncManager_broken.js` | `scripts/` | 2025-11-18 | Broken sync implementation - incompatible with V3 API, needs complete rewrite |

**Context:**  
The old sync manager was designed for the Flask API with different data structures and sync patterns. V3 requires:
- Version-based optimistic locking (If-Match headers)
- Entity-Curation architecture (not flat restaurant structure)
- X-API-Key authentication (not JWT)
- MongoDB document structure with metadata arrays

**Replacement:**  
Will be replaced by new `syncManagerV3.js` implementing bi-directional sync with conflict resolution. See [Implementation Roadmap Phase 3](../docs/COLLECTOR_V3_IMPLEMENTATION_ROADMAP.md#phase-3-sync-manager-6-8-hours).

---

### concierge_parser - reference copy.py

Python script for parsing Michelin data (archived earlier).

**Reason:** V3 will import Michelin data via batch scripts directly to MongoDB. PostgreSQL staging table no longer used.

---

### investigation/

Old investigation and analysis files (archived earlier).

**Reason:** Historical analysis no longer relevant to V3 architecture.

---

### old-configs/, old-docs/, old-html-tools/, old-tests/

Various obsolete configurations and test files (archived earlier).

**Reason:** Not compatible with V3 architecture.

---

## 🔍 Finding Archived Files

If you need to reference old code:

1. **Check this index** to understand why it was archived
2. **Look in the corresponding directory** (old-api-docs/, old-code/, etc.)
3. **Read the replacement documentation** linked above

---

## ⚠️ Important Notes

### Do NOT Use Archived Code

- Archived code is **not maintained** and may contain bugs
- Archived code is **incompatible** with V3 architecture
- Archived code **will not work** with current API or database

### Purpose of Archive

- **Historical reference** - understand past decisions
- **Learning resource** - see what didn't work and why
- **Recovery option** - extreme cases only (should not be needed)

### If You Need Something from Archive

Instead of copying archived code:

1. **Understand the requirement** - what problem were you trying to solve?
2. **Check V3 implementation** - it may already be solved differently
3. **Ask for guidance** - there's likely a better V3-compatible approach
4. **Implement fresh** - don't port old code, write new V3-compatible code

---

## 📚 V3 Documentation

For current documentation, see:

- [Collector V3 Architecture](../docs/COLLECTOR_V3_ARCHITECTURE.md)
- [API V3 Integration Spec](../docs/API_V3_INTEGRATION_SPEC.md)
- [Implementation Roadmap](../docs/COLLECTOR_V3_IMPLEMENTATION_ROADMAP.md)
- [Project Status](../PROJECT_STATUS.md)
- [API V3 README](../concierge-api-v3/README.md)

---

## 🗑️ Future Archiving

When archiving more files:

1. Move file to appropriate subdirectory
2. Update this INDEX.md with entry
3. Document replacement (if any)
4. Remove references from active codebase
5. Update relevant documentation

---

**Remember:** The archive exists for history, not for reuse. Always implement V3-compatible solutions.
