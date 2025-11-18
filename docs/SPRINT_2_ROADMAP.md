# Sprint 2: Google Places Entity Automation - ROADMAP

**Duration**: 5 days (Days 4-8)  
**Focus**: Automate Entity (restaurant) data entry from Google Places  
**Goal**: Transform manual restaurant import into intelligent automated workflow

**⚠️ IMPORTANT**: This sprint focuses on **Entity automation only**. Curations remain manual (human curator-created). Automated suggestions can be generated but must be clearly marked as `source: 'automated'` for the Concierge app to decide when/how to use them.

---

## Entity vs Curation: Critical Distinction

### Data Model Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                         ENTITY                                │
│  (Restaurant/Venue - Factual Data)                           │
│                                                               │
│  • name, location, hours, photos                             │
│  • Google Places metadata                                    │
│  • ratings, reviews (raw data)                               │
│  • CAN BE AUTOMATED ✅                                        │
└──────────────────────────────────────────────────────────────┘
                            │
                            │ 1:N relationship
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                       CURATION                                │
│  (Curator Opinion - Subjective)                              │
│                                                               │
│  • curator_id (human attribution)                            │
│  • concept: "romantic", "family-friendly"                    │
│  • notes: curator's personal insights                        │
│  • MUST BE MANUAL ❌ (human curator only)                    │
└──────────────────────────────────────────────────────────────┘
                            │
                            │ Optional assistance
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  CONCEPT SUGGESTION                           │
│  (AI Assistant - For Curator Review)                         │
│                                                               │
│  • suggested_concept: "romantic"                             │
│  • confidence: 0.85                                          │
│  • source: 'automated'                                       │
│  • status: 'pending_review'                                  │
│  • AUTOMATED HELPER ✅ (curator decides)                     │
└──────────────────────────────────────────────────────────────┘
```

### Workflow Example

**User Action**: "Import nearby restaurants" button

```javascript
// Step 1: Automated Entity Creation ✅
const places = await PlacesService.searchNearby({...});
for (const place of places) {
  // Create Entity automatically
  const entity = PlacesFormatter.placeToEntity(place);
  const entityId = await dataStorage.saveEntityFromAPI(entity);
  
  // Generate concept suggestions (NOT curations)
  const suggestions = await ConceptSuggester.suggestFromReviews(place.reviews);
  for (const suggestion of suggestions) {
    await dataStorage.saveConceptSuggestion({
      entity_id: entityId,
      suggested_concept: suggestion.concept,
      status: 'pending_review'  // Awaiting curator
    });
  }
}

// Step 2: Curator Reviews Suggestions (Later) ✋
// Curator manually reviews each suggestion:
// - Approve → Creates curation with curator_id
// - Reject → Marks as rejected
// - Ignore → Remains pending

// Step 3: Approved Suggestion → Curation 👤
async function approveSuggestion(suggestionId, curatorId) {
  const suggestion = await db.conceptSuggestions.get(suggestionId);
  
  // Create real curation with curator attribution
  await db.curations.add({
    entity_id: suggestion.entity_id,
    curator_id: curatorId,  // Human curator
    concept: suggestion.suggested_concept,
    category: suggestion.category,
    source: 'curator',  // Now it's a real curation
    notes: {
      public: null,
      private: `Originally suggested by AI (${suggestion.confidence})`
    }
  });
  
  // Mark suggestion as approved
  await db.conceptSuggestions.update(suggestionId, {
    status: 'approved',
    approved_by: curatorId,
    approved_at: new Date()
  });
}
```

### Why This Matters for Concierge App

The **Concierge** (client app) can decide:

```javascript
// Concierge App Logic
const entityCurations = await getEntityCurations(entityId);

// Filter by source based on context
const humanCurations = entityCurations.filter(c => c.source === 'curator');
const automatedSuggestions = await getConceptSuggestions(entityId)
  .filter(s => s.status === 'approved');

// Context 1: Premium feature - human curations only
if (user.isPremium) {
  display(humanCurations);  // Only curator-created
}

// Context 2: Budget feature - include AI suggestions
else {
  display([...humanCurations, ...automatedSuggestions]);
}

// Context 3: Discovery mode - show pending suggestions too
if (mode === 'discovery') {
  const pending = await getConceptSuggestions(entityId)
    .filter(s => s.status === 'pending_review');
  display([...humanCurations, ...pending]);
}
```

---

## Overview

Sprint 2 builds on Sprint 1's service architecture to create intelligent automation for **Entity** (restaurant) population from Google Places. 

### Scope Clarification

**✅ IN SCOPE (Automated)**:
- Entity creation from Google Places
- Metadata population (location, hours, photos, ratings)
- Duplicate detection and merging
- Batch import of restaurants
- Concept suggestions (marked as automated)

**❌ OUT OF SCOPE (Manual Only)**:
- Curator-created curations (remain 100% manual)
- Final concept approval (curator decision)
- Entity → Curation linking (curator action)

**🔄 HYBRID (Automated + Manual Review)**:
- Concept extraction from reviews → Saved as suggestions
- Curator can review and approve automated suggestions
- Approved suggestions become real curations with curator attribution

---

## Day 4: PlacesAutomation Service Foundation

### Objectives
- Create PlacesAutomation service for orchestrating automated **Entity** imports
- Implement smart entity creation from Google Places results
- Add deduplication logic to prevent duplicate entities
- **No curation creation** - only entity population

### Tasks

#### 1. Create PlacesAutomation.js (~300 lines)
**Location**: `scripts/services/googlePlaces/PlacesAutomation.js`

**Methods**:
```javascript
// Core entity automation
async autoCreateEntity(place)           // Create ENTITY from Google Place
async autoCreateEntities(places)        // Batch create entities
async checkDuplicate(place)             // Check if entity exists

// Smart deduplication
async findSimilarEntities(name, location) // Fuzzy matching
async mergeMetadata(existing, new)        // Merge place data

// Workflow orchestration  
async processSearchArea(lat, lng, radius) // Auto-process area
async scheduleImport(searchParams)        // Queue for background

// REMOVED: Curation automation (stays manual)
// Curations are created by curators only
```

**Key Features**:
- Google Place → Entity transformation via PlacesFormatter
- Duplicate detection by name + location fuzzy matching
- Metadata merging for existing entities
- Status tracking (pending, processing, completed, error)
- **Entity-only**: No automatic curation creation

#### 2. Add Import Queue to IndexedDB
**Location**: `scripts/dataStorage.js`

**Schema Addition**:
```javascript
importQueue: '++id, status, type, createdAt, processedAt, errorCount'
```

**New Methods**:
```javascript
async addToImportQueue(item)           // Add import task
async getImportQueue(status)           // Get by status
async updateImportStatus(id, status)   // Update status
async clearCompletedImports()          // Cleanup
```

#### 3. Deduplication Strategy
**Algorithm**:
1. Normalize names (lowercase, trim, remove special chars)
2. Calculate Levenshtein distance for name similarity
3. Check geographic proximity (within 50 meters)
4. If match found: merge metadata, don't create duplicate
5. If no match: create new entity

**Implementation**:
```javascript
// In PlacesAutomation.js
calculateNameSimilarity(name1, name2)  // String similarity
calculateDistance(lat1, lng1, lat2, lng2) // Haversine formula
isDuplicate(place, threshold = 0.8)    // Combined check
```

### Deliverables
- ✅ PlacesAutomation.js service (~300 lines)
- ✅ Import queue in IndexedDB
- ✅ Deduplication algorithm implemented
- ✅ Unit tests for duplicate detection

---

## Day 5: Background Processing & Progress Tracking

### Objectives
- Implement Web Worker for non-blocking batch processing
- Create progress tracking UI component
- Add error handling and retry logic

### Tasks

#### 1. Create Import Worker
**Location**: `scripts/workers/importWorker.js`

**Responsibilities**:
- Process import queue in background
- Call PlacesAutomation.autoCreateEntity() for each item
- Report progress via postMessage
- Handle errors with exponential backoff

**Worker Interface**:
```javascript
// Main thread → Worker
postMessage({ 
  action: 'startImport', 
  items: [...] 
})

// Worker → Main thread
postMessage({ 
  type: 'progress', 
  current: 5, 
  total: 20 
})

postMessage({ 
  type: 'complete', 
  success: 18, 
  failed: 2 
})
```

#### 2. Progress Tracking UI
**Location**: `scripts/components/ImportProgressModal.js`

**UI Components**:
- Modal with progress bar
- Current item display
- Success/failure counters
- Cancel button
- Error list (expandable)

**HTML Structure**:
```html
<div id="import-progress-modal">
  <h3>Importing Restaurants</h3>
  <div class="progress-bar">
    <div class="progress-fill"></div>
  </div>
  <p class="progress-text">5 / 20 complete</p>
  <div class="stats">
    <span class="success">18 succeeded</span>
    <span class="failed">2 failed</span>
  </div>
  <button id="cancel-import">Cancel</button>
</div>
```

#### 3. Error Handling & Retry
**Strategy**:
- Max 3 retries per item
- Exponential backoff: 1s, 2s, 4s
- Different errors:
  * Network error → retry
  * Rate limit → wait and retry
  * Invalid data → skip and log
  * Duplicate → skip silently

**Implementation**:
```javascript
async retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(1000 * Math.pow(2, i));
    }
  }
}
```

### Deliverables
- ✅ importWorker.js (~200 lines)
- ✅ ImportProgressModal.js (~150 lines)
- ✅ Error handling with retry logic
- ✅ Cancel functionality

---

## Day 6: AI-Powered Concept Suggestion (Automated, Not Curations)

### Objectives
- Extract concept **suggestions** from Google reviews using OpenAI
- Map concepts to categories (cuisine, mood, occasion, price)
- Create ConceptSuggester service (renamed from ConceptExtractor)
- **Store as suggestions, NOT curations** - curators review and approve

### Tasks

#### 1. Create ConceptSuggester.js (~350 lines)
**Location**: `scripts/services/googlePlaces/ConceptSuggester.js`

**Methods**:
```javascript
// Review processing → SUGGESTIONS only
async suggestFromReviews(reviews)      // Get concept SUGGESTIONS
async categorizeKeywords(keywords)     // Map to categories

// OpenAI integration
async analyzeSentiment(review)         // Positive/negative/neutral
async extractTopics(reviews)           // Main themes

// Batch processing
async processPlaceSuggestions(place)   // Full analysis
async bulkSuggest(places)              // Process multiple

// Suggestion storage (NOT curations)
async saveSuggestion(entityId, concept, confidence)
async getSuggestions(entityId)         // Get pending suggestions
async approveSuggestion(suggestionId, curatorId) // Convert to curation
```

**⚠️ Critical Distinction**:
```javascript
// WRONG: Creating curations directly
await db.curations.add({
  entity_id: entity.id,
  concept: 'romantic',
  curator_id: 'automated'  // ❌ NOT ALLOWED
});

// CORRECT: Creating suggestions for curator review
await db.conceptSuggestions.add({
  entity_id: entity.id,
  suggested_concept: 'romantic',
  confidence: 0.85,
  source: 'automated',
  status: 'pending_review'  // ✅ Curator must approve
});
```

**Prompt Engineering**:
```javascript
const CONCEPT_EXTRACTION_PROMPT = `
Analyze these restaurant reviews and extract:
1. Cuisine types (e.g., Italian, Japanese, Fusion)
2. Mood/Atmosphere (e.g., Romantic, Casual, Upscale)
3. Occasions (e.g., Date Night, Business Lunch, Family)
4. Notable features (e.g., Wine List, Outdoor Seating)

Reviews: [...]

Return JSON: { cuisine: [], mood: [], occasion: [], features: [] }
`;
```

#### 2. Concept Category Mapping
**Categories**:
```javascript
const CONCEPT_CATEGORIES = {
  cuisine: [
    'Italian', 'French', 'Japanese', 'Chinese', 'Mexican',
    'Thai', 'Indian', 'American', 'Mediterranean', 'Fusion'
  ],
  mood: [
    'Romantic', 'Casual', 'Upscale', 'Cozy', 'Modern',
    'Traditional', 'Trendy', 'Intimate', 'Lively'
  ],
  occasion: [
    'Date Night', 'Business Lunch', 'Family Dinner',
    'Celebration', 'Casual Meal', 'Special Occasion'
  ],
  priceRange: [
    'Budget-Friendly', 'Moderate', 'Upscale', 'Fine Dining'
  ]
};
```

#### 3. Integration with PlacesAutomation
**Enhancement**:
```javascript
// In PlacesAutomation.autoCreateEntity()
async autoCreateEntity(place) {
  // Get place details with reviews
  const details = await PlacesService.getPlaceDetails(place.place_id);
  
  // Create entity (WITHOUT concepts - entities don't have concepts)
  const entity = PlacesFormatter.placeToEntity(details);
  const entityId = await dataStorage.saveEntityFromAPI(entity);
  
  // Generate concept SUGGESTIONS (separate from entity)
  const suggestions = await ConceptSuggester.suggestFromReviews(details.reviews);
  
  // Save suggestions for curator review
  for (const suggestion of suggestions) {
    await dataStorage.saveConceptSuggestion({
      entity_id: entityId,
      suggested_concept: suggestion.concept,
      category: suggestion.category,
      confidence: suggestion.confidence,
      source: 'automated',
      source_details: {
        reviews_analyzed: details.reviews.length,
        model: 'gpt-4',
        extracted_at: new Date()
      },
      status: 'pending_review'
    });
  }
  
  return entityId;
}
```

#### 4. Add ConceptSuggestions Table to IndexedDB
**Location**: `scripts/dataStorage.js`

**Schema Addition**:
```javascript
conceptSuggestions: '++id, entity_id, status, source, confidence, createdAt'
```

**New Methods**:
```javascript
async saveConceptSuggestion(suggestion)       // Save automated suggestion
async getConceptSuggestions(entityId)         // Get for entity
async getPendingSuggestions(limit)            // Review queue
async approveSuggestion(suggestionId, curatorId) // → Creates curation
async rejectSuggestion(suggestionId, reason)  // Mark as rejected
```

### Deliverables
- ✅ ConceptSuggester.js service (~350 lines) - renamed from ConceptExtractor
- ✅ OpenAI integration for suggestion generation
- ✅ Category mapping system
- ✅ Suggestion storage (NOT curations)
- ✅ Curator review workflow

---

## Day 7: Bulk Import & Smart Batching

### Objectives
- Implement bulk import from search results
- Add smart batching to respect API limits
- Create import presets (nearby, city-wide, custom)

### Tasks

#### 1. Bulk Import Manager
**Location**: `scripts/services/googlePlaces/BulkImportManager.js`

**Methods**:
```javascript
// Import presets
async importNearby(radius = 5000)        // Import nearby restaurants
async importCity(cityName)               // Import entire city
async importArea(bounds)                 // Custom area

// Smart batching
async batchedImport(places, batchSize)   // Process in batches
async throttledSearch(queries)           // Rate-limited searches

// Progress & stats
getImportStats()                         // Current stats
estimateTime(itemCount)                  // ETA calculation
```

**Batching Strategy**:
```javascript
// Google Places API limits: 60 requests/minute
const BATCH_SIZE = 20;        // Process 20 at a time
const BATCH_DELAY = 2000;     // 2 seconds between batches
const MAX_CONCURRENT = 3;     // 3 API calls in parallel max

async batchedImport(places, batchSize = 20) {
  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize);
    await Promise.all(batch.map(p => this.processPlace(p)));
    await delay(BATCH_DELAY);
  }
}
```

#### 2. Import Presets UI
**Location**: Add to places modal in placesModule.js

**UI Addition**:
```html
<div class="bulk-import-section">
  <h4>Bulk Import Presets</h4>
  <button id="import-nearby">
    Import Nearby (5km)
  </button>
  <button id="import-city">
    Import Entire City
  </button>
  <button id="import-custom">
    Custom Area Import
  </button>
</div>
```

#### 3. Import History
**Location**: `scripts/dataStorage.js` additions

**New Table**:
```javascript
importHistory: '++id, type, startedAt, completedAt, itemCount, status'
```

**Tracking**:
- Import type (nearby, city, custom)
- Start/end timestamps
- Success/failure counts
- Error logs
- Duplicate skips

### Deliverables
- ✅ BulkImportManager.js service (~250 lines)
- ✅ Import presets (nearby, city, custom)
- ✅ Smart batching with rate limiting
- ✅ Import history tracking

---

## Day 8: UI Polish & Testing

### Objectives
- Polish import UI/UX
- Add comprehensive error messages
- Integration testing
- Documentation

### Tasks

#### 1. UI Enhancements
**Import Modal Improvements**:
- Better loading states
- Animated progress bar
- Success/error toasts
- Import summary screen

**Enhanced Error Messages**:
```javascript
const ERROR_MESSAGES = {
  RATE_LIMIT: 'API rate limit reached. Pausing for 60 seconds...',
  NETWORK: 'Network error. Retrying in {seconds}s...',
  DUPLICATE: 'Skipped: {name} already exists',
  INVALID_DATA: 'Invalid data from Google Places for {name}',
  NO_RESULTS: 'No restaurants found in this area'
};
```

#### 2. Integration Testing
**Test Scenarios**:
1. Import 10 nearby restaurants
2. Handle duplicate detection
3. Process with API errors
4. Cancel mid-import
5. Resume failed imports

**Test Data**:
- Mock Google Places responses
- Test duplicate scenarios
- Simulate API failures

#### 3. Documentation
**Create**: `docs/GOOGLE_PLACES_AUTOMATION_GUIDE.md`

**Sections**:
- How automation works
- Import presets usage
- Concept extraction overview
- Troubleshooting common issues
- API quota management

### Deliverables
- ✅ Polished UI/UX
- ✅ Comprehensive error handling
- ✅ Integration tests passing
- ✅ User documentation

---

## Sprint 2 Success Criteria

### Functional Requirements
- ✅ Users can auto-import restaurants from Google Places
- ✅ Duplicate detection prevents redundant entries
- ✅ Concepts automatically extracted from reviews
- ✅ Batch processing doesn't block UI
- ✅ Progress tracking provides clear feedback

### Technical Requirements
- ✅ Web Worker for background processing
- ✅ Rate limiting respects API quotas
- ✅ Error handling with retry logic
- ✅ Import queue persists across sessions
- ✅ All services follow Sprint 1 patterns

### Performance Targets
- Import 100 restaurants in < 5 minutes
- UI remains responsive during import
- < 100ms duplicate detection per entity
- Concept extraction: < 3 seconds per place

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     User Interface                       │
│  "Import Nearby Restaurants" Button                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              PlacesAutomation Service                    │
│  • Auto-create ENTITIES (✅ automated)                  │
│  • Generate concept suggestions (for review)            │
│  • Duplicate detection                                  │
│  • Workflow orchestration                               │
└────┬──────────────────────────┬─────────────────────────┘
     │                          │
     ▼                          ▼
┌────────────────┐    ┌──────────────────────┐
│ PlacesService  │    │  ConceptSuggester    │
│ (Sprint 1)     │    │  • Review analysis   │
│ • API calls    │    │  • AI suggestions    │
│ • Rate limit   │    │  • NOT curations ❌  │
└────────────────┘    └──────────────────────┘
     │                          │
     ▼                          ▼
┌────────────────────────────────────────────────────────┐
│              Background Import Worker                   │
│  • Non-blocking batch processing                       │
│  • Progress reporting                                  │
│  • Error handling & retry                              │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│            IndexedDB (via DataStorage)                   │
│  • entities (✅ automated)                              │
│  • conceptSuggestions (✅ automated, pending review)    │
│  • curations (❌ manual only - curator creates)         │
│  • importQueue                                          │
│  • importHistory                                        │
└─────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Curator Review Interface                    │
│  (Future UI - Not in Sprint 2)                          │
│  • Review pending suggestions                           │
│  • Approve → Creates curation with curator_id           │
│  • Reject → Marks as rejected                           │
└─────────────────────────────────────────────────────────┘
```

### Data Flow: Entity Automation

```
User clicks "Import Nearby" 
    ↓
PlacesService.searchNearby() 
    ↓
Get 20 restaurants from Google Places
    ↓
For each restaurant:
    ├→ PlacesAutomation.autoCreateEntity()
    │     ├→ Check for duplicates
    │     ├→ Create Entity in DB ✅
    │     └→ Generate concept suggestions ✅
    │           └→ Save to conceptSuggestions table
    │                 (status: 'pending_review')
    └→ Report progress to UI
    
Entities created: 20 ✅
Suggestions created: 60 (3 per entity average) ✅
Curations created: 0 (curators do this manually) ❌
```

---

## File Structure After Sprint 2

```
scripts/
├── services/
│   ├── googlePlaces/
│   │   ├── PlacesService.js         (Day 2 - Sprint 1)
│   │   ├── PlacesCache.js           (Day 2 - Sprint 1)
│   │   ├── PlacesFormatter.js       (Day 2 - Sprint 1)
│   │   ├── PlacesAutomation.js      (Day 4 - NEW) ✨
│   │   ├── ConceptExtractor.js      (Day 6 - NEW) ✨
│   │   └── BulkImportManager.js     (Day 7 - NEW) ✨
│   └── V3DataTransformer.js         (Day 3 - Sprint 1)
├── workers/
│   └── importWorker.js              (Day 5 - NEW) ✨
├── components/
│   └── ImportProgressModal.js       (Day 5 - NEW) ✨
└── modules/
    └── placesModule.js              (Enhanced - Sprint 2)
```

---

## Risk Mitigation

### API Rate Limits
**Risk**: Google Places API quotas exceeded  
**Mitigation**: Smart batching, rate limiting, queue system

### Performance
**Risk**: UI blocking during large imports  
**Mitigation**: Web Worker for background processing

### Data Quality
**Risk**: Duplicate entities, incorrect concepts  
**Mitigation**: Fuzzy matching, AI validation, manual review option

### User Experience
**Risk**: Confusing automation, unclear progress  
**Mitigation**: Clear UI, progress tracking, comprehensive error messages

---

## Bonus: Curator Review UI (Optional Extension)

**If time permits in Sprint 2**, create a simple UI for curators to review suggestions:

### Location
`scripts/modules/suggestionReviewModule.js`

### UI Components

```html
<div id="suggestion-review-modal">
  <h3>Review Concept Suggestions</h3>
  
  <div class="suggestion-card">
    <div class="entity-info">
      <h4>Restaurant Name</h4>
      <p class="location">Location info</p>
    </div>
    
    <div class="suggestion">
      <span class="concept-badge">Romantic</span>
      <span class="confidence">85% confidence</span>
      <p class="reason">Based on 12 reviews mentioning: 
        "intimate", "date night", "candlelit"
      </p>
    </div>
    
    <div class="actions">
      <button class="approve">✓ Approve</button>
      <button class="reject">✗ Reject</button>
      <button class="skip">→ Skip</button>
    </div>
  </div>
  
  <div class="stats">
    <span>15 pending</span>
    <span>8 approved today</span>
    <span>2 rejected</span>
  </div>
</div>
```

### Methods

```javascript
async loadPendingSuggestions(limit = 10)
async approveSuggestion(suggestionId) {
  const curator = await getCurrentCurator();
  const suggestion = await db.conceptSuggestions.get(suggestionId);
  
  // Create actual curation
  await db.curations.add({
    entity_id: suggestion.entity_id,
    curator_id: curator.curator_id,
    concept: suggestion.suggested_concept,
    category: suggestion.category,
    source: 'curator',  // Human-approved
    createdAt: new Date()
  });
  
  // Mark suggestion as approved
  await db.conceptSuggestions.update(suggestionId, {
    status: 'approved',
    approved_by: curator.curator_id,
    approved_at: new Date()
  });
}

async rejectSuggestion(suggestionId, reason) {
  await db.conceptSuggestions.update(suggestionId, {
    status: 'rejected',
    rejected_reason: reason,
    rejected_at: new Date()
  });
}
```

**Note**: This is a nice-to-have. Core Sprint 2 focuses on entity automation. Curator review can be built in Sprint 3 or later.

---

## Sprint 2 Estimated Effort

**Day 4**: 3 hours (PlacesAutomation + deduplication)  
**Day 5**: 3 hours (Web Worker + progress UI)  
**Day 6**: 4 hours (ConceptSuggester + suggestion storage)  
**Day 7**: 3 hours (Bulk import + batching)  
**Day 8**: 2 hours (Polish + testing)  
**Bonus**: +2 hours (Curator review UI - optional)

**Total**: ~15 hours over 5 days (17 with bonus)

---

## Next: Sprint 3 Preview

**Sprint 3: Sync & IndexedDB Enhancement** (4 days)
- SyncManagerV3 with conflict resolution
- Optimistic locking support
- Partial/delta sync
- Offline queue with retry

**Sprint 4: Frontend Modernization** (7 days)
- Vite build system
- Web Components
- StateManager with Proxy
- CSS optimization

---

*Ready to start Sprint 2? All foundation from Sprint 1 is solid and tested.*
