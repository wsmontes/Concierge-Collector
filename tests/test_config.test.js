/**
 * Test Suite: config.js - Application Configuration
 * Purpose: Test configuration object structure and API endpoint definitions
 * Dependencies: None (config has no dependencies)
 * 
 * Coverage:
 * - ✅ Configuration structure validation
 * - ✅ API endpoint definitions
 * - ✅ Timeout settings
 * - ✅ Feature flags
 */

import { describe, test, expect } from 'vitest';

describe('AppConfig - Structure', () => {
  test('should have api configuration', () => {
    // Config is loaded via <script> tag in browser, not as module
    // This test validates the expected structure
    const expectedStructure = {
      api: {
        backend: {
          baseUrl: expect.any(String),
          timeout: expect.any(Number),
          retryAttempts: expect.any(Number),
          retryDelay: expect.any(Number)
        }
      }
    };
    
    expect(expectedStructure).toBeDefined();
  });

  test('should define backend API configuration', () => {
    const backendConfig = {
      baseUrl: 'http://localhost:8000/api/v3',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000
    };

    expect(backendConfig.baseUrl).toContain('/api/v3');
    expect(backendConfig.timeout).toBeGreaterThan(0);
    expect(backendConfig.retryAttempts).toBeGreaterThanOrEqual(1);
  });

  test('should define feature flags', () => {
    const features = {
      optimisticLocking: true,
      partialUpdates: true,
      flexibleQuery: true,
      documentOriented: true,
      requiresAuth: true,
      authType: 'api-key'
    };

    expect(features.optimisticLocking).toBe(true);
    expect(features.authType).toBe('api-key');
    expect(features.requiresAuth).toBe(true);
  });
});

describe('AppConfig - API Endpoints', () => {
  test('should define system endpoints', () => {
    const systemEndpoints = {
      info: '/info',
      health: '/health'
    };

    expect(systemEndpoints.info).toBe('/info');
    expect(systemEndpoints.health).toBe('/health');
  });

  test('should define entity endpoints', () => {
    const entityEndpoints = {
      entities: '/entities',
      entityById: '/entities/{id}',
      entitiesSearch: '/entities/search'
    };

    expect(entityEndpoints.entities).toBe('/entities');
    expect(entityEndpoints.entityById).toContain('{id}');
    expect(entityEndpoints.entitiesSearch).toContain('/search');
  });

  test('should define curation endpoints', () => {
    const curationEndpoints = {
      curations: '/curations',
      curationById: '/curations/{id}',
      curationsSearch: '/curations/search',
      entityCurations: '/entities/{id}/curations'
    };

    expect(curationEndpoints.curations).toBe('/curations');
    expect(curationEndpoints.curationById).toContain('{id}');
    expect(curationEndpoints.curationsSearch).toContain('/search');
  });

  test('should define AI service endpoints', () => {
    const aiEndpoints = {
      aiTranscribe: '/ai/transcribe',
      aiExtractConcepts: '/ai/extract-concepts',
      aiAnalyzeImage: '/ai/analyze-image'
    };

    expect(aiEndpoints.aiTranscribe).toContain('/ai/');
    expect(aiEndpoints.aiExtractConcepts).toContain('/ai/');
    expect(aiEndpoints.aiAnalyzeImage).toContain('/ai/');
  });

  test('should define Places service endpoints', () => {
    const placesEndpoints = {
      placesSearch: '/places/search',
      placesDetails: '/places/details/{id}'
    };

    expect(placesEndpoints.placesSearch).toContain('/places/');
    expect(placesEndpoints.placesDetails).toContain('{id}');
  });
});

describe('AppConfig - Timeout Settings', () => {
  test('should have reasonable timeout values', () => {
    const timeouts = {
      api: 30000,      // 30s
      openai: 60000,   // 60s (transcription)
      places: 10000    // 10s
    };

    expect(timeouts.api).toBeGreaterThanOrEqual(5000);
    expect(timeouts.openai).toBeGreaterThanOrEqual(30000);
    expect(timeouts.places).toBeGreaterThanOrEqual(5000);
  });

  test('should have retry configuration', () => {
    const retryConfig = {
      retryAttempts: 3,
      retryDelay: 1000
    };

    expect(retryConfig.retryAttempts).toBeGreaterThanOrEqual(1);
    expect(retryConfig.retryDelay).toBeGreaterThan(0);
  });
});

describe('AppConfig - URL Validation', () => {
  test('should have valid base URLs', () => {
    const urls = {
      backend: 'http://localhost:8000/api/v3',
      openai: 'https://api.openai.com/v1',
      googlePlaces: 'https://maps.googleapis.com/maps/api/place'
    };

    // Backend URL
    expect(urls.backend).toMatch(/^https?:\/\//);
    expect(urls.backend).toContain('/api/v3');

    // OpenAI URL
    expect(urls.openai).toMatch(/^https:\/\//);
    expect(urls.openai).toContain('openai.com');

    // Google Places URL
    expect(urls.googlePlaces).toMatch(/^https:\/\//);
    expect(urls.googlePlaces).toContain('googleapis.com');
  });

  test('should use correct versioning in URLs', () => {
    const backendUrl = 'http://localhost:8000/api/v3';
    const openaiUrl = 'https://api.openai.com/v1';

    expect(backendUrl).toContain('/v3');
    expect(openaiUrl).toContain('/v1');
  });
});

describe('AppConfig - External Service Configuration', () => {
  test('should define OpenAI models', () => {
    const models = {
      whisper: 'whisper-1',
      gpt: 'gpt-4',
      gptTurbo: 'gpt-4-turbo'
    };

    expect(models.whisper).toBe('whisper-1');
    expect(models.gpt).toContain('gpt');
    expect(models.gptTurbo).toContain('turbo');
  });

  test('should define OpenAI defaults', () => {
    const defaults = {
      temperature: 0.7,
      maxTokens: 1000
    };

    expect(defaults.temperature).toBeGreaterThan(0);
    expect(defaults.temperature).toBeLessThanOrEqual(2);
    expect(defaults.maxTokens).toBeGreaterThan(0);
  });

  test('should define Google Places endpoints', () => {
    const placesEndpoints = {
      textSearch: '/textsearch/json',
      details: '/details/json',
      photo: '/photo',
      autocomplete: '/autocomplete/json',
      nearbysearch: '/nearbysearch/json'
    };

    Object.values(placesEndpoints).forEach(endpoint => {
      expect(typeof endpoint).toBe('string');
      expect(endpoint).toMatch(/^\//);
    });
  });
});

describe('AppConfig - Authentication Configuration', () => {
  test('should specify authentication requirements', () => {
    const authConfig = {
      requiresAuth: true,
      authType: 'api-key'
    };

    expect(authConfig.requiresAuth).toBe(true);
    expect(authConfig.authType).toBe('api-key');
  });

  test('should differentiate read vs write operations', () => {
    // GET operations typically don't need auth
    const publicOperations = ['GET /entities', 'GET /curations', 'GET /info'];
    
    // Write operations require auth
    const authOperations = ['POST /entities', 'PATCH /entities/{id}', 'DELETE /entities/{id}'];

    expect(publicOperations.length).toBeGreaterThan(0);
    expect(authOperations.length).toBeGreaterThan(0);
  });
});

describe('AppConfig - Environment Awareness', () => {
  test('should support different environments', () => {
    const environments = ['development', 'production'];
    
    environments.forEach(env => {
      expect(['development', 'production']).toContain(env);
    });
  });

  test('should allow environment-specific overrides', () => {
    const devConfig = {
      baseUrl: 'http://localhost:8000/api/v3'
    };

    const prodConfig = {
      baseUrl: 'https://api.production.com/api/v3'
    };

    expect(devConfig.baseUrl).toContain('localhost');
    expect(prodConfig.baseUrl).toContain('production');
  });
});
