# Concierge Collector

A powerful restaurant curation and collection tool designed for concierges to manage, organize, and sync restaurant data with the Concierge Parser system.

## Features

- **Restaurant Management**: Add, edit, and organize restaurant information with rich metadata
- **Audio Recording**: Record voice notes and transcribe them automatically
- **Google Places Integration**: Search and import restaurant data from Google Places API
- **Michelin Guide Staging**: Import and stage Michelin-starred restaurant data
- **Sync Management**: Two-way synchronization with remote MySQL database via Concierge Parser API
- **Export/Import**: Export collections in multiple formats (JSON, ZIP with audio files)
- **Access Control**: Multi-user support with curator-specific collections
- **Bulk Operations**: Perform operations on multiple restaurants at once

## Project Structure

```
Concierge-Collector/
├── index.html                          # Main application entry point
├── styles/                             # CSS stylesheets
│   ├── style.css                      # Main styles
│   ├── michelin-section.css           # Michelin guide styles
│   ├── mobile-enhancements.css        # Mobile-responsive styles
│   ├── places-section.css             # Google Places styles
│   ├── access-control.css             # Access control UI styles
│   └── sync-badges.css                # Sync status badge styles
├── scripts/                           # JavaScript modules
│   ├── main.js                        # Application entry point
│   ├── moduleWrapper.js               # Module initialization pattern
│   ├── apiService.js                  # API communication layer
│   ├── apiHandler.js                  # API request handling
│   ├── syncManager.js                 # Sync orchestration
│   ├── syncSettingsManager.js         # Sync configuration
│   ├── dataStorage.js                 # IndexedDB data persistence
│   ├── uiManager.js                   # UI orchestration
│   ├── uiUtils.js                     # UI helper utilities
│   ├── audioRecorder.js               # Audio recording functionality
│   ├── conceptMatcher.js              # Concept matching utilities
│   ├── promptTemplate.js              # AI prompt templates
│   ├── accessControl.js               # User access control
│   ├── modules/                       # Feature modules
│   │   ├── safetyUtils.js            # Safety and validation
│   │   ├── uiUtilsModule.js          # UI utilities
│   │   ├── pendingAudioManager.js    # Audio management
│   │   ├── draftRestaurantManager.js # Draft management
│   │   ├── curatorModule.js          # Curator functionality
│   │   ├── recordingModule.js        # Recording controls
│   │   ├── transcriptionModule.js    # Transcription handling
│   │   ├── conceptModule.js          # Concept management
│   │   ├── restaurantModule.js       # Restaurant CRUD
│   │   ├── restaurantListModule.js   # Restaurant list UI
│   │   ├── exportImportModule.js     # Export/import features
│   │   ├── quickActionModule.js      # Quick actions
│   │   ├── michelinStagingModule.js  # Michelin import
│   │   ├── placesModule.js           # Google Places
│   │   └── audioUtils.js             # Audio utilities
│   └── utils/                         # Utility modules
├── data/                              # Application data
├── images/                            # Application assets
├── docs/                              # Documentation
│   ├── ui_specification.md           # UI specifications
│   ├── restaurant_editor_requirements.md # Editor requirements
│   ├── access_control_guide.md       # Access control guide
│   └── mysql_api_testing_guide.md    # API testing guide
├── CONCIERGE_PARSER_API_DOCUMENTATION.md  # API documentation
├── COLLECTOR_SYNC_INTEGRATION_GUIDE.md    # Sync integration guide
└── concierge_export_schema_v2.json       # Export schema definition

```

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Google Maps API key (for Places functionality)
- Concierge Parser API access (for sync functionality)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/wsmontes/Concierge-Collector.git
cd Concierge-Collector
```

2. Open `index.html` in your web browser or serve via a local web server:
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx http-server
```

3. Configure your API credentials in the application settings

## Usage

### Basic Workflow

1. **Select or Create Curator**: Choose your curator profile or create a new one
2. **Add Restaurants**: Use manual entry, Google Places search, or Michelin import
3. **Record Audio**: Record voice notes for restaurants and transcribe automatically
4. **Organize**: Tag, categorize, and curate your restaurant collection
5. **Sync**: Push changes to the remote database or pull updates
6. **Export**: Export your collection for backup or sharing

### Sync Management

The application supports bidirectional sync with a remote MySQL database:

- **Push**: Upload local changes to remote database
- **Pull**: Download remote changes to local storage
- **Conflict Resolution**: Automatic handling of sync conflicts based on timestamps
- **Status Tracking**: Visual indicators for sync status (local only, synced, remote only)

See [COLLECTOR_SYNC_INTEGRATION_GUIDE.md](COLLECTOR_SYNC_INTEGRATION_GUIDE.md) for detailed sync documentation.

### API Integration

The Concierge Parser API provides:
- Restaurant CRUD operations
- User authentication
- Data synchronization
- Bulk operations

See [CONCIERGE_PARSER_API_DOCUMENTATION.md](CONCIERGE_PARSER_API_DOCUMENTATION.md) for full API reference.

## Architecture

### Design Principles

The application follows **Clean Architecture** and **SOLID principles**:

- **Separation of Concerns**: Clear boundaries between UI, business logic, and data layers
- **Module Pattern**: All code organized using the ModuleWrapper pattern
- **No Global Variables**: All state attached to classes or dedicated namespaces
- **Centralized Configuration**: All config in one place
- **Dependency Declaration**: Explicit dependencies at module top

### Key Patterns

- **ModuleWrapper**: Consistent module initialization and registration
- **Service Layer**: API and sync services isolated from UI
- **IndexedDB**: Client-side data persistence
- **Event-Driven**: Module communication via events

## Development

### Code Standards

- No ES6 imports/exports (use ModuleWrapper pattern)
- All files must have header comments describing purpose
- Use `this.` for all class property and method access
- No mock/fake data in production code
- Clear, meaningful comments only

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for complete standards.

### File Headers

Every file must begin with a header comment:

```javascript
/**
 * File: filename.js
 * Purpose: Brief description of what this file does
 * Dependencies: List of required modules
 * Last Updated: Date
 */
```

## Documentation

- [UI Specification](docs/ui_specification.md) - UI design and component specifications
- [Restaurant Editor Requirements](docs/restaurant_editor_requirements.md) - Editor feature requirements
- [Access Control Guide](docs/access_control_guide.md) - User access and permissions
- [MySQL API Testing Guide](docs/mysql_api_testing_guide.md) - API testing procedures
- [Sync Integration Guide](COLLECTOR_SYNC_INTEGRATION_GUIDE.md) - Sync implementation details
- [API Documentation](CONCIERGE_PARSER_API_DOCUMENTATION.md) - Complete API reference

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (iOS optimizations included)
- Mobile: Responsive design with touch optimizations

## License

[Add your license information here]

## Contributing

[Add contribution guidelines here]

## Support

For issues or questions:
- Create an issue in the GitHub repository
- Contact the development team

---

**Note**: This application requires active internet connection for sync functionality, Google Places API, and transcription services.
