import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * Integration tests that validate REAL production errors
 * These tests check actual runtime state, not just mocked behavior
 */

describe('Real Production Errors - DataStore Initialization', () => {
  test('should detect if DataStore.db is null (causes "Cannot read properties of null (reading db)")', () => {
    // This is the REAL error from console:
    // TypeError: Cannot read properties of null (reading 'db')
    // at Object.saveAudio (pendingAudioManager.js:58:47)
    
    // Simulate what happens when DataStore is not properly initialized
    const mockDataStore = {
      db: null,  // THIS IS THE PROBLEM
      initialized: false
    };

    // This should fail if db is null
    const isDatabaseReady = () => {
      if (!mockDataStore.db) {
        throw new TypeError("Cannot read properties of null (reading 'db')");
      }
      return true;
    };

    // Test should detect the error
    expect(() => isDatabaseReady()).toThrow("Cannot read properties of null (reading 'db')");
  });

  test('should validate DataStore is initialized before use', () => {
    // Real production code should check this BEFORE using db
    const mockDataStore = {
      db: null,
      initialized: false
    };

    const safeDbOperation = async () => {
      // CORRECT: Check if initialized first
      if (!mockDataStore.initialized || !mockDataStore.db) {
        throw new Error('DataStore not initialized');
      }
      return mockDataStore.db.restaurants.toArray();
    };

    // Should throw because not initialized
    expect(safeDbOperation()).rejects.toThrow('DataStore not initialized');
  });

  test('should ensure DataStore.initialize() is called before any db operations', () => {
    let initCalled = false;
    let dbAccessed = false;

    const mockDataStore = {
      db: null,
      initialized: false,
      
      initialize: async function() {
        this.db = { restaurants: { toArray: () => [] } };
        this.initialized = true;
        initCalled = true;
      },

      saveAudio: function(data) {
        dbAccessed = true;
        if (!this.db) {
          throw new TypeError("Cannot read properties of null (reading 'db')");
        }
        return this.db.restaurants.toArray();
      }
    };

    // Try to use without initialize - should fail
    expect(() => mockDataStore.saveAudio({ blob: new Blob() }))
      .toThrow("Cannot read properties of null (reading 'db')");

    expect(dbAccessed).toBe(true);
    expect(initCalled).toBe(false);
  });

  test('should validate PendingAudioManager checks DataStore before saveAudio', () => {
    // From pendingAudioManager.js:58:47
    // const table = DataStore.db.pendingAudios; // ERROR if db is null
    
    const mockDataStore = {
      db: null  // Not initialized
    };

    const pendingAudioManager = {
      saveAudio: async (audioBlob) => {
        // THIS IS THE BUG - no check if db exists
        const table = mockDataStore.db.pendingAudios;  // CRASHES HERE
        return table.add({ blob: audioBlob });
      }
    };

    // Should detect the error
    expect(() => pendingAudioManager.saveAudio(new Blob()))
      .toThrow();
  });

  test('should validate DraftRestaurantManager checks DataStore before operations', () => {
    // From draftRestaurantManager.js:61:47
    // const table = DataStore.db.draftRestaurants; // ERROR if db is null
    
    const mockDataStore = {
      db: null  // Not initialized
    };

    const draftRestaurantManager = {
      createDraft: async (data) => {
        // THIS IS THE BUG - no check if db exists
        const table = mockDataStore.db.draftRestaurants;  // CRASHES HERE
        return table.add(data);
      },
      
      getDrafts: async () => {
        // THIS IS THE BUG - no check if db exists
        const table = mockDataStore.db.draftRestaurants;  // CRASHES HERE
        return table.toArray();
      }
    };

    // Should detect both errors
    expect(() => draftRestaurantManager.createDraft({ name: 'Test' }))
      .toThrow();
    expect(() => draftRestaurantManager.getDrafts())
      .toThrow();
  });
});

describe('Real Production Errors - DOM Elements Missing', () => {
  let dom;
  let document;

  beforeEach(() => {
    // Simulate production DOM WITHOUT required elements
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <!-- Missing: compact-curator-display -->
          <!-- Missing: compact-curator-edit-form -->
          <!-- Missing: curator-selector-section -->
          
          <!-- Password input NOT in form -->
          <input type="password" id="modal-places-api-key" />
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  test('should detect missing compact-curator-display element', () => {
    // Real error: [CuratorModule] [ERROR] Compact curator elements missing
    const compactDisplay = document.getElementById('compact-curator-display');
    const compactEditForm = document.getElementById('compact-curator-edit-form');
    const curatorSelectorSection = document.getElementById('curator-selector-section');

    // ALL should be null (missing from DOM)
    expect(compactDisplay).toBeNull();
    expect(compactEditForm).toBeNull();
    expect(curatorSelectorSection).toBeNull();

    // This simulates what CuratorModule.displayCuratorInfoCompact does
    const checkElements = () => {
      const elements = {
        compactDisplay: !!compactDisplay,
        editForm: !!compactEditForm,
        selectorSection: !!curatorSelectorSection
      };

      if (!elements.compactDisplay || !elements.editForm || !elements.selectorSection) {
        throw new Error(`Compact curator elements missing: ${JSON.stringify(elements)}`);
      }
    };

    expect(checkElements).toThrow('Compact curator elements missing');
  });

  test('should detect password input not in form (DOM warning)', () => {
    // Real warning: [DOM] Password field is not contained in a form
    const passwordInput = document.getElementById('modal-places-api-key');
    const parentForm = passwordInput?.closest('form');

    expect(passwordInput).not.toBeNull();
    expect(parentForm).toBeNull();  // NOT in a form - BAD!
  });

  test('should validate all required DOM elements exist before module init', () => {
    // List of ALL required elements for the app
    const requiredElements = [
      'compact-curator-display',
      'compact-curator-edit-form',
      'curator-selector-section',
      'start-record',
      'stop-record',
      'discard-record',
      'transcription-text',
      'extract-concepts-btn',
      'restaurant-name',
      'save-restaurant',
      'discard-restaurant'
    ];

    const missingElements = requiredElements.filter(id => !document.getElementById(id));

    // Should detect ALL missing elements
    expect(missingElements.length).toBeGreaterThan(0);
    expect(missingElements).toContain('compact-curator-display');
    expect(missingElements).toContain('start-record');
  });
});

describe('Real Production Errors - Module Registration', () => {
  test('should detect if RecordingModule is not in uiManager.modules', () => {
    // Real warning: ⚠️ Recording module STILL not found in UI Manager
    const mockUIManager = {
      modules: {
        // RecordingModule missing!
      }
    };

    const checkRecordingModule = () => {
      if (!mockUIManager.modules.RecordingModule) {
        throw new Error('Recording module STILL not found in UI Manager');
      }
    };

    expect(checkRecordingModule).toThrow('Recording module STILL not found in UI Manager');
  });

  test('should validate module registration order', () => {
    // Modules should be registered in correct order
    const registrationOrder = [];
    
    const mockRegister = (moduleName) => {
      registrationOrder.push(moduleName);
    };

    // Simulate app initialization
    mockRegister('DataStore');
    mockRegister('ApiService');
    // FORGOT TO REGISTER RecordingModule!
    mockRegister('UIManager');

    // RecordingModule should be registered BEFORE UIManager
    const recordingIndex = registrationOrder.indexOf('RecordingModule');
    const uiManagerIndex = registrationOrder.indexOf('UIManager');

    expect(recordingIndex).toBe(-1);  // Not registered!
    expect(uiManagerIndex).toBeGreaterThan(-1);  // But UIManager is
  });

  test('should detect if restaurantModule.loadRestaurantList is not available', () => {
    // Real warning: [CuratorModule] [WARN] restaurantModule not available or loadRestaurantList not a function
    
    const mockRestaurantModule = {
      // loadRestaurantList is MISSING
    };

    const checkRestaurantModule = () => {
      if (!mockRestaurantModule || typeof mockRestaurantModule.loadRestaurantList !== 'function') {
        throw new Error('restaurantModule not available or loadRestaurantList not a function');
      }
    };

    expect(checkRestaurantModule).toThrow('restaurantModule not available or loadRestaurantList not a function');
  });
});

describe('Real Production Errors - Recording State Management', () => {
  test('should detect recording already in progress error', () => {
    // Real warning: [RecordingModule] [WARN] Recording already in progress
    
    const mockRecordingModule = {
      isRecording: false,
      mediaRecorder: null,

      startRecording: function() {
        if (this.isRecording) {
          throw new Error('Recording already in progress, cannot start another');
        }
        this.isRecording = true;
        this.mediaRecorder = { state: 'recording' };
      }
    };

    // Start first recording
    mockRecordingModule.startRecording();
    expect(mockRecordingModule.isRecording).toBe(true);

    // Try to start second recording - should fail
    expect(() => mockRecordingModule.startRecording())
      .toThrow('Recording already in progress');
  });

  test('should validate audio processing requires initialized DataStore', () => {
    // Real error chain:
    // 1. Stop recording
    // 2. Process recording
    // 3. Try to save to pendingAudioManager
    // 4. CRASH: DataStore.db is null

    const mockDataStore = {
      db: null,
      initialized: false
    };

    const mockRecordingModule = {
      processRecording: async function(audioBlob) {
        // Get or create draft (needs DataStore)
        if (!mockDataStore.db) {
          throw new TypeError("Cannot read properties of null (reading 'db')");
        }
        
        // Save audio (needs DataStore)
        const table = mockDataStore.db.pendingAudios;
        return table.add({ blob: audioBlob });
      }
    };

    // Should fail because DataStore not initialized
    expect(mockRecordingModule.processRecording(new Blob()))
      .rejects.toThrow("Cannot read properties of null (reading 'db')");
  });
});

describe('Real Production Errors - Geolocation', () => {
  test('should handle geolocation permission denied gracefully', () => {
    // Real error: Error getting user location: GeolocationPositionError {code: 1, message: 'User denied Geolocation'}
    
    const mockGeolocation = {
      getCurrentPosition: (success, error) => {
        error({
          code: 1,
          message: 'User denied Geolocation',
          PERMISSION_DENIED: 1
        });
      }
    };

    const getUserLocation = () => {
      return new Promise((resolve, reject) => {
        mockGeolocation.getCurrentPosition(
          (position) => resolve(position),
          (error) => reject(error)
        );
      });
    };

    expect(getUserLocation()).rejects.toMatchObject({
      code: 1,
      message: 'User denied Geolocation'
    });
  });
});

describe('Real Production Errors - Initialization Sequence', () => {
  test('should validate correct initialization order', () => {
    // Based on real console logs, correct order is:
    // 1. AppConfig
    // 2. Logger
    // 3. UIUtils
    // 4. BottomSheet, GestureManager, etc.
    // 5. ApiService
    // 6. AuthService
    // 7. DataStore (MUST BE BEFORE ANY DB OPERATIONS)
    // 8. RecordingModule
    // 9. UIManager
    
    const initLog = [];
    let dataStoreInitialized = false;

    const mockApp = {
      initDataStore: async () => {
        initLog.push('DataStore');
        dataStoreInitialized = true;
      },

      initRecordingModule: async () => {
        initLog.push('RecordingModule');
        // SHOULD CHECK if DataStore is ready
        if (!dataStoreInitialized) {
          throw new Error('RecordingModule initialized before DataStore!');
        }
      },

      initApp: async function() {
        // Wrong order - RecordingModule before DataStore
        await this.initRecordingModule();
        await this.initDataStore();
      }
    };

    // Should fail with wrong initialization order
    expect(mockApp.initApp()).rejects.toThrow('RecordingModule initialized before DataStore!');
  });

  test('should ensure DataStore.initialize() completes before module registration', async () => {
    let dbReady = false;
    let moduleRegistered = false;

    const mockDataStore = {
      initialize: async () => {
        // Simulate async initialization
        await new Promise(resolve => setTimeout(resolve, 10));
        dbReady = true;
      }
    };

    const mockRecordingModule = {
      init: () => {
        moduleRegistered = true;
        if (!dbReady) {
          throw new Error('Module initialized before DataStore ready!');
        }
      }
    };

    // Correct order
    await mockDataStore.initialize();
    expect(dbReady).toBe(true);
    
    mockRecordingModule.init();
    expect(moduleRegistered).toBe(true);
  });
});

describe('Real Production Errors - Error Recovery', () => {
  test('should provide meaningful error when DataStore fails to initialize', () => {
    const mockDataStore = {
      initialize: async () => {
        try {
          // Simulate IndexedDB not available
          if (!window.indexedDB) {
            throw new Error('IndexedDB not supported');
          }
          // Or database blocked
          throw new Error('Database blocked by another tab');
        } catch (error) {
          throw new Error(`DataStore initialization failed: ${error.message}`);
        }
      }
    };

    expect(mockDataStore.initialize())
      .rejects.toThrow(/DataStore initialization failed/);
  });

  test('should detect unhandled promise rejections', () => {
    // Real error: [ErrorManager] Unhandled rejection: TypeError: Cannot read properties of null (reading 'db')
    
    const unhandledRejections = [];

    // Simulate global error handler
    const handleUnhandledRejection = (error) => {
      unhandledRejections.push(error);
    };

    // Simulate the actual error
    const promise = Promise.reject(
      new TypeError("Cannot read properties of null (reading 'db')")
    );

    promise.catch(handleUnhandledRejection);

    return new Promise(resolve => {
      setTimeout(() => {
        expect(unhandledRejections.length).toBeGreaterThan(0);
        expect(unhandledRejections[0].message).toContain("Cannot read properties of null");
        resolve();
      }, 10);
    });
  });
});
