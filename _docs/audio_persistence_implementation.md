# Audio Persistence and Draft Management Implementation

## Date: October 16, 2025

## Overview
This document summarizes the implementation of audio persistence and draft restaurant management features for the Concierge Collector application.

## Requirements Addressed

1. **Audio Persistence**: Keep recorded audio in browser storage until transcription completes and restaurant is saved
2. **Draft Management**: Save incomplete restaurants with any metadata as drafts
3. **UI Indicators**: Show badges and indicators for pending recordings
4. **Storage Strategy**: Use IndexedDB for audio storage (handles files up to 10 minutes)
5. **Retry Logic**: Automatic retry (2 attempts with exponential backoff) + manual retry option

## Changes Implemented

### 1. Database Schema Updates (`dataStorage.js`)

**Version Updated**: 6 → 7

**New Tables**:
- `pendingAudio`: Stores audio blobs awaiting transcription
  - Fields: id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional
  
- `draftRestaurants`: Stores incomplete restaurant data
  - Fields: id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description, metadata (JSON)

### 2. New Modules Created

#### A. PendingAudioManager (`scripts/modules/pendingAudioManager.js`)
**Purpose**: Manage audio recordings awaiting transcription

**Key Methods**:
- `saveAudio(audioBlob, metadata)`: Save audio to IndexedDB
- `getAudio(audioId)`: Retrieve audio by ID
- `getAudios(filter)`: Get all audios with filters
- `getAudioCounts()`: Get counts by status (pending, processing, failed, completed)
- `updateAudio(audioId, updates)`: Update audio record
- `incrementRetryCount(audioId, errorMessage)`: Track retry attempts
- `canAutoRetry(audio)`: Check if auto-retry is possible
- `scheduleAutoRetry(audioId, retryCallback)`: Schedule automatic retry with delay
- `deleteAudio(audioId)`: Delete audio from storage
- `cleanupOldAudios(daysOld)`: Clean up completed audios older than X days

**Retry Configuration**:
- Max auto-retries: 2
- Retry delays: [5000ms, 15000ms] (5s, 15s)
- Exponential backoff strategy

#### B. DraftRestaurantManager (`scripts/modules/draftRestaurantManager.js`)
**Purpose**: Manage incomplete restaurant data

**Key Methods**:
- `createDraft(curatorId, data)`: Create new draft
- `getDraft(draftId)`: Retrieve draft with parsed metadata
- `getDrafts(curatorId)`: Get all drafts for curator
- `updateDraft(draftId, data)`: Update draft data
- `autoSaveDraft(draftId, data)`: Auto-save with 3-second debounce
- `hasData(draft)`: Check if draft has meaningful data
- `getCompletionPercentage(draft)`: Calculate completion (0-100%)
- `deleteDraft(draftId)`: Delete draft and associated audio
- `cleanupOldDrafts(daysOld)`: Remove empty drafts older than X days
- `draftToRestaurantData(draft)`: Convert draft to restaurant format
- `getOrCreateCurrentDraft(curatorId)`: Get or create working draft

**Auto-Save Configuration**:
- Debounce delay: 3000ms (3 seconds)
- Triggers: name, transcription, description, concepts, location, photos changes

### 3. RecordingModule Updates (`scripts/modules/recordingModule.js`)

**Modified Methods**:

#### `processRecording(audioBlob, pendingAudioId)`
- Now saves audio to IndexedDB before transcription
- Links audio to draft restaurant
- Updates audio status (pending → processing → completed/failed)
- Implements retry logic on transcription failure
- Schedules automatic retries with exponential backoff
- Shows manual retry UI after max auto-retries

**New Methods**:

#### `showManualRetryUI(audioId)`
- Creates retry UI with warning message
- Provides "Retry Transcription" button with loading state
- Provides "Delete Audio" button with confirmation
- Auto-removes UI on successful retry

#### `showPendingAudioBadge()`
- Displays badge with pending audio count
- Shows on recording section header
- Updates dynamically as audios are processed
- Clickable to show pending audio list

#### `showPendingAudioList()`
- Lists all pending, processing, and failed audios
- TODO: Full UI for managing pending audios

### 4. ConceptModule Updates (`scripts/modules/conceptModule.js`)

**Auto-Save Implementation**:

#### `autoSaveDraft()`
- Silently saves draft data every 3 seconds after changes
- Collects: name, transcription, description, concepts, location, photos
- Only saves if there's meaningful data
- Skips auto-save when editing saved restaurants
- Creates or gets current draft for curator

**Event Listeners Added**:
- `restaurant-name` input event
- `restaurant-transcription` input event
- `restaurant-description` input event
- Location save trigger
- Concept add trigger

**Cleanup on Save**:
- Deletes pending audio associated with restaurant/draft
- Deletes draft restaurant after successful save
- Updates pending audio badge
- Silent cleanup - doesn't interrupt user flow

### 5. Main Application Updates (`scripts/main.js`)

**Initialization Sequence**:
1. Initialize DataStorage (database)
2. Initialize PendingAudioManager with dataStorage
3. Initialize DraftRestaurantManager with dataStorage
4. Initialize UIManager
5. Load curator info
6. Show pending audio badge if audios exist

### 6. HTML Updates (`index.html`)

**New Script Includes**:
- `scripts/modules/pendingAudioManager.js`
- `scripts/modules/draftRestaurantManager.js`

**Load Order**: Before other modules, after core utilities

## User Flow

### Recording Flow
1. User starts recording
2. Audio captured to blob
3. User stops recording
4. **Audio saved to IndexedDB immediately**
5. Audio conversion to MP3/Opus
6. Transcription attempt #1
   - Success: Mark audio as completed, process transcription
   - Failure: Schedule retry #1 after 5 seconds
7. Retry #1 (if needed)
   - Success: Mark completed, process transcription
   - Failure: Schedule retry #2 after 15 seconds
8. Retry #2 (if needed)
   - Success: Mark completed, process transcription
   - Failure: Show manual retry UI

### Draft Management Flow
1. User enters any data (name, transcription, etc.)
2. After 3 seconds of inactivity, draft auto-saves
3. Draft persists across page reloads
4. When restaurant is saved:
   - Associated pending audio deleted
   - Draft deleted
   - User returns to restaurant list

### Manual Retry Flow
1. User sees warning message with retry options
2. Click "Retry Transcription":
   - Button shows loading state
   - Retry counter resets
   - Transcription attempted again
   - UI removed on success
3. Click "Delete Audio":
   - Confirmation dialog
   - Audio permanently removed
   - UI dismissed

## UI Components

### Pending Audio Badge
- **Location**: Recording section header (h2)
- **Appearance**: Yellow badge with count
- **Format**: "{count} pending"
- **Behavior**: Clickable, shows on hover
- **Updates**: Dynamically after audio processing

### Manual Retry UI
- **Location**: Top of recording section or transcription container
- **Style**: Yellow warning box with left border
- **Content**: Warning icon, message, retry button, delete button
- **State**: Shows only after max auto-retries exhausted

### Draft Indicators (TODO)
- Restaurant list "Drafts" filter
- Draft completion percentage
- Visual styling for draft restaurants

## Storage Considerations

### Audio Storage
- **Format**: Blob in IndexedDB
- **Size Limit**: ~10 minutes recording ≈ 5-10MB
- **Browser Limit**: IndexedDB typically 50MB+ available
- **Cleanup**: Completed audios cleaned after 7 days

### Draft Storage
- **Format**: Structured data + JSON metadata
- **Size**: Minimal (text + references)
- **Cleanup**: Empty drafts cleaned after 30 days

## Error Handling

### Transcription Failures
1. **Network errors**: Auto-retry with backoff
2. **API errors**: Auto-retry with backoff
3. **Audio format errors**: Conversion attempted, then retry
4. **Max retries reached**: Manual retry UI shown

### Storage Failures
1. **Quota exceeded**: Logged, cleanup triggered
2. **Database errors**: Reset database if critical
3. **Save failures**: Silent for auto-save, shown for manual save

## Future Enhancements (Not Implemented)

1. **Pending Audio List Modal**: Full UI for managing all pending audios
2. **Draft Restaurant List**: Filter view showing all drafts with completion %
3. **Draft Recovery**: Prompt to restore draft when returning to app
4. **Offline Sync**: Queue audios for transcription when online
5. **Progress Indicators**: Real-time transcription progress
6. **Audio Playback**: Preview audio before retry/delete
7. **Batch Operations**: Retry/delete multiple audios at once

## Testing Checklist

- [ ] Record audio → saves to IndexedDB before transcription
- [ ] Successful transcription → audio marked as completed
- [ ] Failed transcription → auto-retry with correct delays
- [ ] Max retries → manual retry UI appears
- [ ] Manual retry → transcription attempted again
- [ ] Delete audio → audio removed from storage
- [ ] Auto-save draft → saves after 3 seconds of inactivity
- [ ] Draft persistence → survives page reload
- [ ] Restaurant save → cleanup pending audio and draft
- [ ] Pending badge → shows correct count
- [ ] Badge updates → refreshes after audio processing
- [ ] Edit restaurant → doesn't auto-save over existing data
- [ ] Multiple curators → drafts separated by curator

## Configuration

### Retry Settings
```javascript
maxAutoRetries: 2
retryDelays: [5000, 15000] // 5s, 15s
```

### Auto-Save Settings
```javascript
autoSaveDelay: 3000 // 3 seconds
```

### Cleanup Settings
```javascript
audioCleanupAge: 7 // days
draftCleanupAge: 30 // days
```

## Dependencies

- **Dexie.js**: IndexedDB wrapper
- **ModuleWrapper**: Application module pattern
- **SafetyUtils**: UI notifications and loading states
- **UIManager**: Application state management
- **DataStorage**: Database access layer

## Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support (with iOS-specific audio handling)
- **Mobile**: Full support with touch-optimized UI

## Performance Considerations

- Audio blobs stored efficiently as Blob type (not base64)
- Auto-save debounced to prevent excessive writes
- Cleanup runs periodically to prevent database bloat
- Retry delays increase exponentially to avoid API throttling
- Badge updates batched to reduce DOM operations

## Security Considerations

- Audio stored locally (not transmitted until transcription)
- Draft data encrypted by browser's IndexedDB
- No sensitive data logged
- Cleanup ensures old data doesn't persist indefinitely
- User confirmation required for delete operations

## Documentation

- All functions documented with JSDoc comments
- Module headers describe purpose and dependencies
- Inline comments explain complex logic
- TODO markers for future enhancements
