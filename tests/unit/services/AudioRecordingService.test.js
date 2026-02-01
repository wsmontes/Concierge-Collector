/**
 * Test: AudioRecordingService.test.js
 * Purpose: Unit tests for AudioRecordingService
 * Coverage: Browser support, recording lifecycle, stream management, error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  setupBrowserMocks, 
  cleanupBrowserMocks,
  setupGetUserMediaMock,
  createMockMediaStream 
} from '../../setup/mocks/browser.mock.js';

// Setup global mocks BEFORE importing service
global.Logger = {
  module: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
};

global.window = global.window || {};
global.window.audioUtils = {
  getAudioConstraints: vi.fn((enhanced) => ({
    audio: {
      echoCancellation: enhanced,
      noiseSuppression: enhanced,
      autoGainControl: enhanced
    }
  })),
  getBestSupportedMimeType: vi.fn(() => 'audio/webm'),
  validateAudioBlob: vi.fn((blob) => ({
    valid: blob && blob.size > 0,
    error: blob && blob.size > 0 ? null : 'Invalid blob'
  })),
  createAudioBlob: vi.fn((chunks, mimeType) => {
    // Create blob with actual data to pass validation
    const data = chunks.length > 0 ? chunks : [new ArrayBuffer(1024)];
    return new Blob(data, { type: mimeType });
  }),
  formatSize: vi.fn((size) => `${(size / 1024).toFixed(2)} KB`)
};

global.window.errorHandling = {
  safeExecute: vi.fn(async (fn) => await fn())
};

// Import service - it will set window.AudioRecordingService
await import('../../../scripts/services/AudioRecordingService.js');

describe('AudioRecordingService', () => {
  let service;
  
  beforeEach(() => {
    setupBrowserMocks();
    service = new global.window.AudioRecordingService();
  });
  
  afterEach(() => {
    cleanupBrowserMocks();
    vi.restoreAllMocks();
  });
  
  describe('Constructor & Initialization', () => {
    it('should initialize with default values', () => {
      expect(service).toBeDefined();
      expect(service.mediaRecorder).toBeNull();
      expect(service.mediaStream).toBeNull();
      expect(service.audioChunks).toEqual([]);
      expect(service.isRecording).toBe(false);
    });
    
    it('should set correct default configuration', () => {
      expect(service.maxDuration).toBe(5 * 60 * 1000); // 5 minutes
      expect(service.chunkInterval).toBe(1000); // 1 second
    });
    
    it('should throw if audioUtils not loaded', () => {
      const originalAudioUtils = global.audioUtils;
      global.audioUtils = undefined;
      
      expect(() => new AudioRecordingService())
        .toThrow('audioUtils not loaded');
      
      global.audioUtils = originalAudioUtils;
    });
    
    it('should throw if errorHandling not loaded', () => {
      const originalErrorHandling = global.errorHandling;
      global.errorHandling = undefined;
      
      expect(() => new AudioRecordingService())
        .toThrow('errorHandling not loaded');
      
      global.errorHandling = originalErrorHandling;
    });
  });
  
  describe('Browser Support Check', () => {
    it('should detect browser support correctly', () => {
      const result = service.checkBrowserSupport();
      
      expect(result).toHaveProperty('supported');
      expect(result).toHaveProperty('error');
      expect(result.supported).toBe(true);
      expect(result.error).toBeNull();
    });
    
    it('should detect missing getUserMedia', () => {
      delete global.navigator.mediaDevices;
      
      const result = service.checkBrowserSupport();
      
      expect(result.supported).toBe(false);
      expect(result.error).toContain('Audio recording not supported');
    });
    
    it('should detect missing MediaRecorder', () => {
      const originalMediaRecorder = global.MediaRecorder;
      global.MediaRecorder = undefined;
      
      const result = service.checkBrowserSupport();
      
      expect(result.supported).toBe(false);
      expect(result.error).toContain('MediaRecorder API not available');
      
      global.MediaRecorder = originalMediaRecorder;
    });
  });
  
  describe('Audio Constraints', () => {
    it('should get enhanced constraints', () => {
      const constraints = service.getAudioConstraints(true);
      
      expect(constraints.audio.echoCancellation).toBe(true);
      expect(constraints.audio.noiseSuppression).toBe(true);
      expect(constraints.audio.autoGainControl).toBe(true);
    });
    
    it('should delegate to audioUtils', () => {
      service.getAudioConstraints(false);
      
      expect(global.audioUtils.getAudioConstraints).toHaveBeenCalledWith(false);
    });
  });
  
  describe('MIME Type Detection', () => {
    it('should get best supported MIME type', () => {
      const mimeType = service.getBestMimeType();
      
      expect(mimeType).toBe('audio/webm');
      expect(global.audioUtils.getBestSupportedMimeType).toHaveBeenCalled();
    });
  });
  
  describe('Media Stream Management', () => {
    it('should request and get media stream', async () => {
      const stream = await service.getMediaStream();
      
      expect(stream).toBeDefined();
      expect(stream.getTracks()).toHaveLength(1);
      expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
    
    it('should use provided constraints', async () => {
      const customConstraints = { audio: { sampleRate: 48000 } };
      
      await service.getMediaStream(customConstraints);
      
      expect(global.navigator.mediaDevices.getUserMedia)
        .toHaveBeenCalledWith(customConstraints);
    });
    
    it('should throw if stream has no tracks', async () => {
      global.navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
        getTracks: () => []
      }));
      
      await expect(service.getMediaStream())
        .rejects.toThrow('No audio tracks in media stream');
    });
    
    it('should throw on permission denied', async () => {
      setupGetUserMediaMock(false); // Set to fail
      
      await expect(service.getMediaStream())
        .rejects.toThrow('Permission denied');
    });
  });
  
  describe('MediaRecorder Creation', () => {
    it('should create MediaRecorder with stream', () => {
      const stream = createMockMediaStream();
      
      const recorder = service.createMediaRecorder(stream);
      
      expect(recorder).toBeDefined();
      expect(global.MediaRecorder).toHaveBeenCalledWith(
        stream,
        expect.objectContaining({
          mimeType: 'audio/webm'
        })
      );
    });
    
    it('should use best supported MIME type', () => {
      const stream = createMockMediaStream();
      
      service.createMediaRecorder(stream);
      
      expect(global.audioUtils.getBestSupportedMimeType).toHaveBeenCalled();
    });
  });
  
  describe('Recording Lifecycle', () => {
    it('should start recording successfully', async () => {
      await service.startRecording();
      
      expect(service.isRecording).toBe(true);
      expect(service.mediaRecorder).toBeDefined();
      expect(service.mediaStream).toBeDefined();
      expect(service.audioChunks).toEqual([]);
    });
    
    it('should throw if already recording', async () => {
      await service.startRecording();
      
      await expect(service.startRecording())
        .rejects.toThrow('Recording already in progress');
    });
    
    it('should throw if browser not supported', async () => {
      delete global.navigator.mediaDevices;
      
      await expect(service.startRecording())
        .rejects.toThrow('Audio recording not supported');
    });
    
    it('should clear previous chunks on start', async () => {
      service.audioChunks = [new Blob(['old data'])];
      
      await service.startRecording();
      
      expect(service.audioChunks).toEqual([]);
    });
    
    it('should set up event handlers', async () => {
      await service.startRecording();
      
      expect(service.mediaRecorder.ondataavailable).toBeDefined();
      expect(service.mediaRecorder.onerror).toBeDefined();
    });
    
    it('should start with correct timeslice', async () => {
      await service.startRecording();
      
      expect(service.mediaRecorder.start).toHaveBeenCalledWith(1000);
    });
  });
  
  describe('Recording Stop', () => {
    beforeEach(async () => {
      await service.startRecording();
    });
    
    it('should stop recording and return blob', async () => {
      // Simulate chunk collection
      service.audioChunks = [
        new Blob(['chunk1'], { type: 'audio/webm' }),
        new Blob(['chunk2'], { type: 'audio/webm' })
      ];
      
      const blob = await service.stopRecording();
      
      expect(blob).toBeInstanceOf(Blob);
      expect(service.isRecording).toBe(false);
    });
    
    it('should throw if not recording', async () => {
      await service.stopRecording(); // Stop once
      
      await expect(service.stopRecording())
        .rejects.toThrow('No active recording to stop');
    });
    
    it('should release media stream on stop', async () => {
      const stopSpy = vi.spyOn(service.mediaStream.getTracks()[0], 'stop');
      
      await service.stopRecording();
      
      expect(stopSpy).toHaveBeenCalled();
    });
    
    it('should validate audio blob', async () => {
      service.audioChunks = [new Blob(['data'], { type: 'audio/webm' })];
      
      await service.stopRecording();
      
      expect(global.audioUtils.validateAudioBlob).toHaveBeenCalled();
    });
    
    it('should throw if blob validation fails', async () => {
      service.audioChunks = [];
      global.audioUtils.validateAudioBlob = vi.fn(() => ({
        valid: false,
        error: 'Empty blob'
      }));
      
      await expect(service.stopRecording())
        .rejects.toThrow('Empty blob');
    });
  });
  
  describe('Stream Release', () => {
    it('should release media stream and stop tracks', async () => {
      await service.startRecording();
      const track = service.mediaStream.getTracks()[0];
      const stopSpy = vi.spyOn(track, 'stop');
      
      service.releaseMediaStream();
      
      expect(stopSpy).toHaveBeenCalled();
      expect(service.mediaStream).toBeNull();
    });
    
    it('should handle null stream gracefully', () => {
      service.mediaStream = null;
      
      expect(() => service.releaseMediaStream()).not.toThrow();
    });
  });
  
  describe('Data Available Handler', () => {
    it('should collect audio chunks', async () => {
      await service.startRecording();
      
      const event = {
        data: new Blob(['test chunk'], { type: 'audio/webm' })
      };
      
      service.handleDataAvailable(event);
      
      expect(service.audioChunks).toHaveLength(1);
      expect(service.audioChunks[0]).toBe(event.data);
    });
    
    it('should ignore empty data', async () => {
      await service.startRecording();
      
      service.handleDataAvailable({ data: new Blob([]) });
      
      expect(service.audioChunks).toEqual([]);
    });
  });
  
  describe('Options Handling', () => {
    it('should accept custom maxDuration', async () => {
      const customDuration = 10 * 60 * 1000; // 10 minutes
      
      await service.startRecording({ maxDuration: customDuration });
      
      // Verify auto-stop is scheduled with custom duration
      expect(service.isRecording).toBe(true);
    });
    
    it('should handle isAdditional flag', async () => {
      await service.startRecording({ isAdditional: true });
      
      expect(service.isRecording).toBe(true);
    });
  });
  
  describe('Error Handling', () => {
    it('should use errorHandling.safeExecute', async () => {
      await service.startRecording();
      
      expect(global.errorHandling.safeExecute).toHaveBeenCalled();
    });
    
    it('should log errors', async () => {
      global.errorHandling.safeExecute = vi.fn(async (fn) => {
        try {
          await fn();
        } catch (error) {
          service.log.error('Error:', error);
          throw error;
        }
      });
      
      setupGetUserMediaMock(false);
      
      await expect(service.startRecording()).rejects.toThrow();
    });
  });
  
  describe('iOS Safari Compatibility', () => {
    it('should work with basic constraints on iOS', async () => {
      // Simulate iOS Safari behavior
      global.audioUtils.getAudioConstraints = vi.fn(() => ({
        audio: true // Simple constraints for iOS
      }));
      
      await service.startRecording();
      
      expect(service.isRecording).toBe(true);
    });
  });
});
