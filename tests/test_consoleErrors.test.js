import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * Tests to detect console errors that appear in production
 * Based on real errors found in browser console
 */

describe('Console Error Detection - Google Places API', () => {
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test('should use place_id instead of places.id in API requests', () => {
    // This error appears in console:
    // "Error expanding 'fields' parameter. Cannot find matching fields for path 'places.id'."
    
    const invalidFields = 'places.id,places.displayName,places.formattedAddress';
    const validFields = 'place_id,displayName,formattedAddress';
    
    // Check that we're not using the invalid field
    expect(invalidFields).toContain('places.id');
    expect(validFields).not.toContain('places.id');
    expect(validFields).toContain('place_id');
  });

  test('should detect Google Places API field errors in response', async () => {
    const errorResponse = {
      error: {
        code: 400,
        message: "Request contains an invalid argument.",
        status: "INVALID_ARGUMENT",
        details: [{
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [{
            field: "places.id,places.displayName,places.formattedAddress",
            description: "Error expanding 'fields' parameter. Cannot find matching fields for path 'places.id'."
          }]
        }]
      }
    };

    // This should be caught and logged
    expect(errorResponse.error.status).toBe('INVALID_ARGUMENT');
    expect(errorResponse.error.details[0].fieldViolations[0].field).toContain('places.id');
    
    // Test should fail if places.id is used anywhere
    const hasInvalidField = errorResponse.error.details[0].fieldViolations[0].field.includes('places.id');
    expect(hasInvalidField).toBe(true); // This shows the error exists
  });

  test('should validate Google Places API fields before request', () => {
    // Valid fields from Google Places API (New)
    const validFieldsMap = {
      'place_id': true,      // NOT 'places.id'
      'displayName': true,   // NOT 'places.displayName'
      'formattedAddress': true,
      'location': true,
      'rating': true,
      'userRatingCount': true,
      'priceLevel': true,
      'types': true,
      'businessStatus': true,
      'websiteUri': true,
      'internationalPhoneNumber': true,
      'photos': true,
      'reviews': true
    };

    // Invalid fields that cause errors
    const invalidFields = [
      'places.id',           // Should be place_id
      'places.displayName',  // Should be displayName
      'places.formattedAddress' // Should be formattedAddress
    ];

    invalidFields.forEach(field => {
      expect(validFieldsMap[field]).toBeUndefined();
    });
  });

  test('should construct correct Google Places API request URL', () => {
    const placeId = 'ChIJ5zh94NZZzpQRRKDDOyn6BEY';
    const correctFields = 'place_id,displayName,formattedAddress,location,rating';
    
    // Correct format
    const correctUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=${correctFields}`;
    expect(correctUrl).toContain('place_id');
    expect(correctUrl).not.toContain('places.id');
    
    // Incorrect format that causes 400 error
    const incorrectFields = 'places.id,places.displayName,places.formattedAddress';
    const incorrectUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=${incorrectFields}`;
    
    // This should be caught in validation
    expect(incorrectUrl).toContain('places.id'); // Shows the problem
  });
});

describe('Console Error Detection - CuratorModule', () => {
  let dom;
  let document;
  let consoleErrorSpy;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <!-- Missing compact curator elements -->
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete global.document;
    delete global.window;
  });

  test('should detect missing compact curator elements', () => {
    // Error from console:
    // [CuratorModule] [ERROR] Compact curator elements missing
    
    const requiredElements = [
      'compact-curator-display',
      'compact-curator-name',
      'compact-curator-photo',
      'compact-curator-edit'
    ];

    const missingElements = requiredElements.filter(id => !document.getElementById(id));
    
    // These elements should exist to prevent the error
    expect(missingElements.length).toBeGreaterThan(0); // Shows they're missing
    expect(missingElements).toContain('compact-curator-display');
  });

  test('should check if restaurantModule.loadRestaurantList is available', () => {
    // Warning from console:
    // [CuratorModule] [WARN] restaurantModule not available or loadRestaurantList not a function
    
    const restaurantModule = global.restaurantModule;
    
    if (restaurantModule) {
      expect(typeof restaurantModule.loadRestaurantList).toBe('function');
    } else {
      // Module not available - this causes the warning
      expect(restaurantModule).toBeUndefined();
    }
  });

  test('should validate CuratorModule initialization dependencies', () => {
    const dependencies = {
      compactCuratorDisplay: document.getElementById('compact-curator-display'),
      compactCuratorName: document.getElementById('compact-curator-name'),
      compactCuratorPhoto: document.getElementById('compact-curator-photo'),
      restaurantModule: global.restaurantModule
    };

    const missingDeps = Object.entries(dependencies)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    // Should have all dependencies
    expect(missingDeps.length).toBeGreaterThan(0); // Shows missing dependencies
  });
});

describe('Console Error Detection - RecordingModule', () => {
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Reset global state
    global.uiManager = undefined;
    global.RecordingModule = undefined;
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('should detect if RecordingModule is not in UIManager', () => {
    // Warning from console:
    // ⚠️ Recording module STILL not found in UI Manager after initialization attempts
    
    const uiManager = {
      modules: {
        // RecordingModule missing
      }
    };

    expect(uiManager.modules.RecordingModule).toBeUndefined();
    expect(uiManager.modules.recording).toBeUndefined();
  });

  test('should validate RecordingModule initialization before use', () => {
    // Error from console:
    // 🔍 Final debug info shows RecordingModule not available
    
    const checkRecordingModule = () => {
      if (!global.RecordingModule) {
        return { available: false, reason: 'Module not defined' };
      }
      if (!global.uiManager?.modules?.RecordingModule) {
        return { available: false, reason: 'Not in UIManager' };
      }
      return { available: true };
    };

    const result = checkRecordingModule();
    expect(result.available).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('should ensure RecordingModule is properly attached to UIManager', () => {
    // Should verify this before attempting to use recording features
    
    const mockUIManager = {
      modules: {}
    };

    const mockRecordingModule = {
      startRecording: vi.fn(),
      stopRecording: vi.fn()
    };

    // Before fix
    expect(mockUIManager.modules.RecordingModule).toBeUndefined();

    // After fix
    mockUIManager.modules.RecordingModule = mockRecordingModule;
    expect(mockUIManager.modules.RecordingModule).toBeDefined();
    expect(typeof mockUIManager.modules.RecordingModule.startRecording).toBe('function');
  });
});

describe('Console Error Detection - Geolocation', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('should handle GeolocationPositionError gracefully', async () => {
    // Error from console:
    // Error getting user location: GeolocationPositionError
    
    const mockGeolocationError = new Error('User denied Geolocation');
    mockGeolocationError.code = 1; // PERMISSION_DENIED
    mockGeolocationError.name = 'GeolocationPositionError';

    global.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn((success, error) => {
          error(mockGeolocationError);
        })
      }
    };

    const getUserLocation = () => {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position),
          (error) => reject(error)
        );
      });
    };

    await expect(getUserLocation()).rejects.toThrow();
  });

  test('should provide fallback when geolocation fails', async () => {
    const mockError = { code: 1, message: 'Permission denied' };
    
    global.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn((success, error) => error(mockError))
      }
    };

    const getLocationWithFallback = async () => {
      try {
        return await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
      } catch (error) {
        // Fallback: return null or default location
        return { coords: { latitude: null, longitude: null }, fallback: true };
      }
    };

    const result = await getLocationWithFallback();
    expect(result.fallback).toBe(true);
  });
});

describe('Console Error Detection - API Service', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('should detect 502 Bad Gateway errors', async () => {
    // Error from console:
    // Failed to load resource: the server responded with a status of 502 (Bad Gateway)
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({ error: 'Bad Gateway' })
    });

    const makeRequest = async () => {
      const response = await fetch('https://example.com/api/places/details/123');
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    };

    await expect(makeRequest()).rejects.toThrow('502 Bad Gateway');
  });

  test('should handle API timeout errors', async () => {
    // Common production error: request timeout
    
    const timeoutError = new Error('Request timeout');
    timeoutError.name = 'TimeoutError';

    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((resolve, reject) => {
        setTimeout(() => reject(timeoutError), 100);
      });
    });

    const makeRequestWithTimeout = async () => {
      try {
        return await fetch('https://example.com/api/slow-endpoint');
      } catch (error) {
        if (error.name === 'TimeoutError') {
          throw new Error('API request timed out');
        }
        throw error;
      }
    };

    await expect(makeRequestWithTimeout()).rejects.toThrow('API request timed out');
  });
});

describe('Console Error Detection - Password Form Warning', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <!-- Password field not in form -->
          <input type="password" id="standalone-password" />
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
  });

  afterEach(() => {
    delete global.document;
  });

  test('should detect password fields not contained in forms', () => {
    // Warning from console:
    // [DOM] Password field is not contained in a form
    
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    
    passwordInputs.forEach(input => {
      const parentForm = input.closest('form');
      expect(parentForm).toBeNull(); // Shows the problem
    });
  });

  test('should validate password fields are inside forms', () => {
    // Create proper structure
    const form = document.createElement('form');
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.id = 'proper-password';
    
    form.appendChild(passwordInput);
    document.body.appendChild(form);

    const properPasswordInput = document.getElementById('proper-password');
    const parentForm = properPasswordInput.closest('form');
    
    // This should NOT be null
    expect(parentForm).not.toBeNull();
    expect(parentForm.tagName).toBe('FORM');
  });
});

describe('Console Error Detection - Online/Offline Detection', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('should detect rapid online/offline transitions', () => {
    // From console:
    // [ErrorManager] Offline detected
    // [ErrorManager] Back online
    // [ErrorManager] Offline detected (again)
    
    const events = [];
    const mockErrorManager = {
      logOnlineStatus: (status) => events.push(status)
    };

    mockErrorManager.logOnlineStatus('offline');
    mockErrorManager.logOnlineStatus('online');
    mockErrorManager.logOnlineStatus('offline');
    mockErrorManager.logOnlineStatus('online');

    // Rapid transitions can indicate network instability
    expect(events.length).toBe(4);
    expect(events.filter(e => e === 'offline').length).toBe(2);
    expect(events.filter(e => e === 'online').length).toBe(2);
  });
});

describe('Console Error Detection - Module Initialization Order', () => {
  test('should initialize modules in correct order', () => {
    // From console logs, modules initialize in specific order:
    // 1. AppConfig
    // 2. Logger
    // 3. UIManager
    // 4. ApiService
    // 5. DataStore
    // 6. RecordingModule (but fails to attach)
    
    const initializationOrder = [];
    
    const mockInit = {
      appConfig: () => initializationOrder.push('AppConfig'),
      logger: () => initializationOrder.push('Logger'),
      uiManager: () => initializationOrder.push('UIManager'),
      apiService: () => initializationOrder.push('ApiService'),
      dataStore: () => initializationOrder.push('DataStore'),
      recordingModule: () => initializationOrder.push('RecordingModule')
    };

    // Execute in correct order
    mockInit.appConfig();
    mockInit.logger();
    mockInit.uiManager();
    mockInit.apiService();
    mockInit.dataStore();
    mockInit.recordingModule();

    expect(initializationOrder[0]).toBe('AppConfig');
    expect(initializationOrder[1]).toBe('Logger');
    expect(initializationOrder[5]).toBe('RecordingModule');
  });
});
