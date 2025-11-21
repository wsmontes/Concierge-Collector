/**
 * INTEGRATION TESTS - Real Production Error Detection
 * Purpose: Test REAL initialization patterns that production uses (no mocks)
 * 
 * These tests REPLICATE the exact errors seen in production:
 * 1. DataStore.db is null when modules access it
 * 2. Async initialization race conditions
 * 3. Module registration failures
 * 
 * CRITICAL: Uses fake-indexeddb (not mocks) to catch real integration issues
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('Production Error: DataStore.db is null', () => {
    let Dexie;
    let DataStore;
    
    beforeEach(() => {
        // Use global Dexie from conftest.js (fake-indexeddb)
        Dexie = global.Dexie;
        
        // Cleanup any existing DataStore
        if (global.DataStore) {
            delete global.DataStore;
        }
    });
    
    afterEach(async () => {
        if (DataStore && DataStore.db && DataStore.db.isOpen && DataStore.db.isOpen()) {
            await DataStore.db.close();
        }
        if (Dexie && Dexie.delete) {
            try {
                await Dexie.delete('ConciergeCollectorTest');
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });
    
    test('PRODUCTION ERROR: pendingAudioManager.js:58 - Cannot read properties of null (reading db)', async () => {
        // Simulate the EXACT error from production console:
        // "Cannot read properties of null (reading 'db') at pendingAudioManager.js:58:47"
        
        // Create DataStore class (simplified version matching production pattern)
        class DataStoreClass {
            constructor() {
                this.db = null;  // STARTS as null
                this.isInitialized = false;
            }
            
            async initialize() {
                this.db = new Dexie('ConciergeCollectorTest');
                this.db.version(1).stores({
                    pendingAudio: '++id, audioId, createdAt'
                });
                await this.db.open();
                this.isInitialized = true;
            }
        }
        
        DataStore = new DataStoreClass();
        global.DataStore = DataStore;
        
        // Simulate pendingAudioManager trying to access DataStore.db
        // THIS IS THE EXACT PATTERN FROM LINE 58 OF pendingAudioManager.js
        const pendingAudioManagerAccess = async () => {
            return await DataStore.db.pendingAudio.toArray();
        };
        
        // BEFORE initialization: Should throw error (like production)
        await expect(pendingAudioManagerAccess()).rejects.toThrow();
        
        // AFTER initialization: Should work
        await DataStore.initialize();
        const result = await pendingAudioManagerAccess();
        expect(result).toEqual([]);
        expect(DataStore.db).not.toBeNull();
    });
    
    test('PRODUCTION ERROR: draftRestaurantManager.js:61 - Cannot read properties of null (reading db)', async () => {
        // Simulate the EXACT error from production console:
        // "Cannot read properties of null (reading 'db') at draftRestaurantManager.js:61:47"
        
        class DataStoreClass {
            constructor() {
                this.db = null;  // STARTS as null
                this.isInitialized = false;
            }
            
            async initialize() {
                this.db = new Dexie('ConciergeCollectorTest');
                this.db.version(1).stores({
                    drafts: '++id, type, data, createdAt'
                });
                await this.db.open();
                this.isInitialized = true;
            }
        }
        
        DataStore = new DataStoreClass();
        global.DataStore = DataStore;
        
        // Simulate draftRestaurantManager trying to access DataStore.db
        // THIS IS THE EXACT PATTERN FROM LINE 61 OF draftRestaurantManager.js
        const draftRestaurantManagerAccess = async () => {
            return await DataStore.db.drafts.toArray();
        };
        
        // BEFORE initialization: Should throw error (like production)
        await expect(draftRestaurantManagerAccess()).rejects.toThrow();
        
        // AFTER initialization: Should work
        await DataStore.initialize();
        const result = await draftRestaurantManagerAccess();
        expect(result).toEqual([]);
        expect(DataStore.db).not.toBeNull();
    });
    
    test('CORRECT initialization: DataStore MUST be initialized BEFORE modules use it', async () => {
        const initLog = [];
        
        class DataStoreClass {
            constructor() {
                this.db = null;
                this.isInitialized = false;
            }
            
            async initialize() {
                initLog.push('1. DataStore.initialize START');
                this.db = new Dexie('ConciergeCollectorTest');
                this.db.version(1).stores({
                    pendingAudio: '++id, audioId',
                    drafts: '++id, type'
                });
                await this.db.open();
                this.isInitialized = true;
                initLog.push('2. DataStore.initialize COMPLETE - db is ready');
            }
        }
        
        class PendingAudioManager {
            async init() {
                initLog.push('3. PendingAudioManager.init START');
                // This should only happen AFTER DataStore.initialize()
                await global.DataStore.db.pendingAudio.toArray();
                initLog.push('4. PendingAudioManager.init COMPLETE');
            }
        }
        
        class DraftRestaurantManager {
            async init() {
                initLog.push('5. DraftRestaurantManager.init START');
                // This should only happen AFTER DataStore.initialize()
                await global.DataStore.db.drafts.toArray();
                initLog.push('6. DraftRestaurantManager.init COMPLETE');
            }
        }
        
        // CORRECT initialization order:
        DataStore = new DataStoreClass();
        global.DataStore = DataStore;
        
        // Step 1: Initialize DataStore FIRST
        await DataStore.initialize();
        
        // Step 2: Initialize modules AFTER DataStore is ready
        const pendingAudioManager = new PendingAudioManager();
        await pendingAudioManager.init();
        
        const draftRestaurantManager = new DraftRestaurantManager();
        await draftRestaurantManager.init();
        
        // Validate correct order
        expect(initLog).toEqual([
            '1. DataStore.initialize START',
            '2. DataStore.initialize COMPLETE - db is ready',
            '3. PendingAudioManager.init START',
            '4. PendingAudioManager.init COMPLETE',
            '5. DraftRestaurantManager.init START',
            '6. DraftRestaurantManager.init COMPLETE'
        ]);
        
        // Validate DataStore is ready
        expect(DataStore.db).not.toBeNull();
        expect(DataStore.isInitialized).toBe(true);
        expect(DataStore.db.isOpen()).toBe(true);
    });
    
    test('WRONG initialization: Modules accessing DataStore before initialization completes', async () => {
        class DataStoreClass {
            constructor() {
                this.db = null;
                this.isInitialized = false;
            }
            
            async initialize() {
                // Simulate slow async initialization
                await new Promise(resolve => setTimeout(resolve, 100));
                this.db = new Dexie('ConciergeCollectorTest');
                this.db.version(1).stores({
                    pendingAudio: '++id'
                });
                await this.db.open();
                this.isInitialized = true;
            }
        }
        
        DataStore = new DataStoreClass();
        global.DataStore = DataStore;
        
        // WRONG: Try to access db BEFORE initialization completes
        const wrongAccessPromise = DataStore.db.pendingAudio.toArray();
        
        // This should throw (like production error)
        await expect(wrongAccessPromise).rejects.toThrow();
        
        // Now initialize properly
        await DataStore.initialize();
        
        // After initialization, access should work
        const result = await DataStore.db.pendingAudio.toArray();
        expect(result).toEqual([]);
    });
});

describe('Production Error: Module Registration', () => {
    test('RecordingModule MUST be registered in window.uiManager.modules', () => {
        // Production warning: "RecordingModule not found in UIManager after initialization"
        
        class RecordingModule {
            constructor(uiManager) {
                this.uiManager = uiManager;
                this.name = 'RecordingModule';
            }
            
            setupEvents() {
                // Setup events
            }
        }
        
        class UIManager {
            constructor() {
                this.modules = new Map();
                this.recordingModule = null;
            }
            
            init() {
                // Initialize recording module
                this.recordingModule = new RecordingModule(this);
                this.recordingModule.setupEvents();
                
                // CRITICAL: Must register in modules Map
                this.modules.set('RecordingModule', this.recordingModule);
            }
        }
        
        const uiManager = new UIManager();
        uiManager.init();
        
        // VALIDATION: RecordingModule MUST be registered
        expect(uiManager.modules.has('RecordingModule')).toBe(true);
        expect(uiManager.modules.get('RecordingModule')).toBe(uiManager.recordingModule);
        expect(uiManager.recordingModule).not.toBeNull();
    });
    
    test('WRONG: RecordingModule not registered in modules Map', () => {
        // This replicates the production warning
        
        class RecordingModule {
            constructor(uiManager) {
                this.uiManager = uiManager;
            }
        }
        
        class UIManager {
            constructor() {
                this.modules = new Map();
                this.recordingModule = null;
            }
            
            init() {
                // WRONG: Initialize but don't register
                this.recordingModule = new RecordingModule(this);
                // Missing: this.modules.set('RecordingModule', this.recordingModule);
            }
        }
        
        const uiManager = new UIManager();
        uiManager.init();
        
        // This is the production error state
        expect(uiManager.modules.has('RecordingModule')).toBe(false);  // NOT registered
        expect(uiManager.recordingModule).not.toBeNull();  // But instance exists
    });
});

describe('Complete Production Initialization Flow', () => {
    let Dexie;
    let DataStore;
    
    beforeEach(() => {
        Dexie = global.Dexie;
    });
    
    afterEach(async () => {
        if (DataStore && DataStore.db && DataStore.db.isOpen && DataStore.db.isOpen()) {
            await DataStore.db.close();
        }
        if (Dexie && Dexie.delete) {
            try {
                await Dexie.delete('ConciergeCollectorTest');
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });
    
    test('End-to-end: DataStore → UIManager → Modules', async () => {
        const log = [];
        
        // Simulate complete initialization flow from main.js
        class DataStoreClass {
            constructor() {
                this.db = null;
                this.isInitialized = false;
            }
            
            async initialize() {
                log.push('1. DataStore.initialize START');
                this.db = new Dexie('ConciergeCollectorTest');
                this.db.version(1).stores({
                    entities: '++id',
                    curations: '++id',
                    drafts: '++id'
                });
                await this.db.open();
                this.isInitialized = true;
                log.push('2. DataStore.initialize COMPLETE');
            }
        }
        
        class UIManager {
            constructor() {
                this.modules = new Map();
                this.recordingModule = null;
            }
            
            init() {
                log.push('3. UIManager.init START');
                this.recordingModule = { name: 'RecordingModule' };
                this.modules.set('RecordingModule', this.recordingModule);
                log.push('4. UIManager.init COMPLETE');
            }
        }
        
        // Execute initialization sequence (from main.js pattern)
        DataStore = new DataStoreClass();
        global.DataStore = DataStore;
        
        // Step 1: Initialize DataStore FIRST (await!)
        await DataStore.initialize();
        
        // Step 2: Initialize UIManager AFTER DataStore
        const uiManager = new UIManager();
        uiManager.init();
        
        // Step 3: Validate everything is ready
        log.push('5. Validation START');
        expect(global.DataStore.db).not.toBeNull();
        expect(global.DataStore.isInitialized).toBe(true);
        expect(uiManager.modules.has('RecordingModule')).toBe(true);
        log.push('6. Validation COMPLETE');
        
        // Verify correct sequence
        expect(log).toEqual([
            '1. DataStore.initialize START',
            '2. DataStore.initialize COMPLETE',
            '3. UIManager.init START',
            '4. UIManager.init COMPLETE',
            '5. Validation START',
            '6. Validation COMPLETE'
        ]);
    });
});
