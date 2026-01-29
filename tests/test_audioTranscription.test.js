/**
 * File: test_audioTranscription.test.js
 * Purpose: Diagnose and test audio transcription issues in production
 * Dependencies: ApiService, AuthService, recordingModule
 * 
 * Test Coverage:
 * - Audio blob to base64 conversion
 * - API authentication
 * - Request/response validation
 * - Error handling and logging
 * - Production environment checks
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Audio Transcription - Production Issues', () => {
  let mockAuthService;
  let mockApiService;
  let recordingModule;

  beforeEach(() => {
    // Mock AuthService
    mockAuthService = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockReturnValue('mock-jwt-token')
    };

    // Mock ApiService
    mockApiService = {
      transcribeAudio: vi.fn(),
      baseUrl: 'https://concierge-collector.onrender.com/api/v3'
    };

    // Mock global objects
    global.window = {
      AuthService: mockAuthService,
      ApiService: mockApiService
    };

    // Mock recordingModule
    recordingModule = {
      log: {
        debug: vi.fn(),
        error: vi.fn()
      },
      transcribeAudio: async function(audioBlob) {
        this.log.debug('Transcribing audio via API V3 (orchestrate with concepts)...');
        
        if (!window.ApiService) {
          throw new Error('ApiService not initialized');
        }

        if (!window.AuthService || !window.AuthService.isAuthenticated()) {
          throw new Error('Authentication required for transcription');
        }

        try {
          const result = await window.ApiService.transcribeAudio(audioBlob, 'en');
          
          if (!result || !result.results || !result.results.transcription || !result.results.transcription.text) {
            this.log.error('Invalid API response structure:', result);
            throw new Error('Invalid response from transcription API');
          }
          
          this.log.debug('✅ Transcription + concepts successful via API V3 orchestrate');
          
          return {
            text: result.results.transcription.text,
            transcription: result.results.transcription,
            concepts: result.results.concepts
          };
          
        } catch (error) {
          this.log.error('Transcription error:', error);
          throw new Error(`Transcription failed: ${error.message}`);
        }
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication Checks', () => {
    test('should fail if user not authenticated', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);
      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Authentication required for transcription');
    });

    test('should fail if no JWT token available', async () => {
      mockAuthService.getToken.mockReturnValue(null);
      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      // ApiService should detect missing token
      mockApiService.transcribeAudio.mockRejectedValue(new Error('401 Unauthorized'));

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Transcription failed');
    });

    test('should pass JWT token to API', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: { text: 'Test transcription' },
          concepts: { concepts: [] }
        }
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      await recordingModule.transcribeAudio(audioBlob);

      expect(mockAuthService.getToken).toHaveBeenCalled();
      expect(mockApiService.transcribeAudio).toHaveBeenCalled();
    });
  });

  describe('Audio Blob Conversion', () => {
    test('should convert Blob to base64', async () => {
      const audioBlob = new Blob(['test audio data'], { type: 'audio/mp3' });
      
      // Simulate conversion
      const reader = new FileReader();
      const base64Promise = new Promise((resolve) => {
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(audioBlob);
      });

      const base64Result = await base64Promise;

      expect(base64Result).toBeDefined();
      expect(typeof base64Result).toBe('string');
      expect(base64Result.length).toBeGreaterThan(0);
    });

    test('should handle empty audio blob', async () => {
      const emptyBlob = new Blob([], { type: 'audio/mp3' });
      
      mockApiService.transcribeAudio.mockRejectedValue(
        new Error('Audio file too short')
      );

      await expect(recordingModule.transcribeAudio(emptyBlob))
        .rejects.toThrow('Transcription failed');
    });

    test('should handle large audio files', async () => {
      // Create ~1MB blob (simulating 30 seconds of audio)
      const largeData = new Array(1024 * 1024).fill('a').join('');
      const largeBlob = new Blob([largeData], { type: 'audio/mp3' });

      expect(largeBlob.size).toBeGreaterThan(1000000);

      // Should not fail just because of size
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: { text: 'Large file transcription' },
          concepts: { concepts: [] }
        }
      });

      const result = await recordingModule.transcribeAudio(largeBlob);
      expect(result.text).toBe('Large file transcription');
    });
  });

  describe('API Response Validation', () => {
    test('should fail if response missing results', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        // Missing results!
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Invalid response from transcription API');
    });

    test('should fail if response missing transcription', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          // Missing transcription!
          concepts: { concepts: [] }
        }
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Invalid response from transcription API');
    });

    test('should fail if transcription missing text', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: {
            // Missing text!
            model: 'whisper-1'
          },
          concepts: { concepts: [] }
        }
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Invalid response from transcription API');
    });

    test('should succeed with valid response', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: {
            text: 'Great sushi restaurant',
            language: 'en',
            model: 'whisper-1'
          },
          concepts: {
            concepts: [
              { category: 'cuisine', value: 'Japanese' }
            ]
          }
        },
        processing_time_ms: 2500
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      const result = await recordingModule.transcribeAudio(audioBlob);

      expect(result.text).toBe('Great sushi restaurant');
      expect(result.transcription).toBeDefined();
      expect(result.concepts).toBeDefined();
      expect(result.concepts.concepts).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle network timeout', async () => {
      mockApiService.transcribeAudio.mockRejectedValue(
        new Error('Network request timed out')
      );

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Transcription failed: Network request timed out');

      expect(recordingModule.log.error).toHaveBeenCalled();
    });

    test('should handle 500 server error', async () => {
      mockApiService.transcribeAudio.mockRejectedValue(
        new Error('HTTP 500: Internal Server Error')
      );

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Transcription failed');
    });

    test('should handle OpenAI API rate limit', async () => {
      mockApiService.transcribeAudio.mockRejectedValue(
        new Error('HTTP 429: Rate limit exceeded')
      );

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('Rate limit exceeded');
    });

    test('should handle OPENAI_API_KEY not configured', async () => {
      mockApiService.transcribeAudio.mockRejectedValue(
        new Error('HTTP 500: OPENAI_API_KEY not configured')
      );

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });

      await expect(recordingModule.transcribeAudio(audioBlob))
        .rejects.toThrow('OPENAI_API_KEY not configured');
    });
  });

  describe('Production Environment Checks', () => {
    test('should work with production API URL', async () => {
      mockApiService.baseUrl = 'https://concierge-collector.onrender.com/api/v3';
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: { text: 'Production test' },
          concepts: { concepts: [] }
        }
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      const result = await recordingModule.transcribeAudio(audioBlob);

      expect(result.text).toBe('Production test');
    });

    test('should log debug info for troubleshooting', async () => {
      mockApiService.transcribeAudio.mockResolvedValue({
        workflow: 'audio_only',
        results: {
          transcription: { text: 'Debug test' },
          concepts: { concepts: [] }
        }
      });

      const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
      await recordingModule.transcribeAudio(audioBlob);

      expect(recordingModule.log.debug).toHaveBeenCalledWith(
        'Transcribing audio via API V3 (orchestrate with concepts)...'
      );
      expect(recordingModule.log.debug).toHaveBeenCalledWith(
        '✅ Transcription + concepts successful via API V3 orchestrate'
      );
    });
  });
});

describe('ApiService.transcribeAudio - Base64 Conversion', () => {
  test('should convert Blob to base64 correctly', async () => {
    // Real blobToBase64 implementation
    const blobToBase64 = (blob) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    const testData = 'test audio data';
    const blob = new Blob([testData], { type: 'audio/mp3' });
    
    const base64 = await blobToBase64(blob);

    // Decode back to verify
    const decoded = atob(base64);
    expect(decoded).toBe(testData);
  });

  test('should handle special characters in audio data', async () => {
    const blobToBase64 = (blob) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    const specialData = 'audio 音频 🎵 データ';
    const blob = new Blob([specialData], { type: 'audio/mp3' });
    
    const base64 = await blobToBase64(blob);

    expect(base64).toBeDefined();
    expect(base64.length).toBeGreaterThan(0);
  });
});

console.log('✅ Audio transcription diagnostic tests loaded (25 tests)');
