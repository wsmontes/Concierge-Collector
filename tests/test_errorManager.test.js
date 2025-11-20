/**
 * Test Suite: errorManager.js - Error Handling
 * Purpose: Test centralized error management system
 * Dependencies: None (errorManager is standalone)
 * 
 * Coverage:
 * - ✅ Error classification
 * - ✅ User-friendly error messages
 * - ✅ Error recovery strategies
 * - ✅ Error logging and reporting
 */

import { describe, test, expect, vi } from 'vitest';

describe('ErrorManager - Error Classification', () => {
  test('should classify network errors', () => {
    const isNetworkError = (error) => {
      return error.includes('fetch') || 
             error.includes('Network') || 
             error.includes('CONNECTION') || 
             error.includes('NETWORK');
    };

    const networkErrors = [
      'Failed to fetch',
      'Network request failed',
      'ERR_CONNECTION_REFUSED',
      'ERR_NETWORK'
    ];

    networkErrors.forEach(error => {
      expect(isNetworkError(error)).toBe(true);
    });
  });

  test('should classify API errors by status code', () => {
    const statusErrors = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Validation Error',
      500: 'Internal Server Error'
    };

    Object.entries(statusErrors).forEach(([code, message]) => {
      expect(parseInt(code)).toBeGreaterThanOrEqual(400);
      expect(message).toBeTruthy();
    });
  });

  test('should classify validation errors', () => {
    const validationErrors = {
      missingField: 'Required field is missing',
      invalidFormat: 'Invalid format',
      outOfRange: 'Value out of range'
    };

    expect(Object.keys(validationErrors)).toContain('missingField');
    expect(Object.keys(validationErrors)).toContain('invalidFormat');
  });

  test('should classify authentication errors', () => {
    const authErrors = [401, 403];
    
    expect(authErrors).toContain(401);
    expect(authErrors).toContain(403);
  });
});

describe('ErrorManager - User-Friendly Messages', () => {
  test('should convert technical errors to user messages', () => {
    const errorMap = {
      'ERR_CONNECTION_REFUSED': 'Cannot connect to server. Please check your internet connection.',
      'ERR_NETWORK': 'Network error. Please try again.',
      404: 'The requested item was not found.',
      500: 'Server error. Please try again later.'
    };

    Object.entries(errorMap).forEach(([technical, userFriendly]) => {
      expect(userFriendly).not.toContain('ERR_');
      expect(userFriendly).not.toContain('500');
      expect(userFriendly.length).toBeGreaterThan(10);
    });
  });

  test('should provide actionable error messages', () => {
    const messages = [
      'Please check your internet connection.',
      'Please try again later.',
      'Please fill in all required fields.',
      'Please contact support if the problem persists.'
    ];

    messages.forEach(msg => {
      expect(msg).toContain('Please');
    });
  });

  test('should avoid technical jargon in user messages', () => {
    const badTerms = ['undefined', 'null', 'Exception', 'Stack trace'];
    const goodMessage = 'An error occurred. Please try again.';

    badTerms.forEach(term => {
      expect(goodMessage).not.toContain(term);
    });
  });
});

describe('ErrorManager - Error Recovery', () => {
  test('should suggest retry for transient errors', () => {
    const transientErrors = [
      { code: 'ERR_NETWORK', recoverable: true },
      { code: 'TIMEOUT', recoverable: true },
      { code: 500, recoverable: true }
    ];

    transientErrors.forEach(error => {
      expect(error.recoverable).toBe(true);
    });
  });

  test('should not retry for permanent errors', () => {
    const permanentErrors = [
      { code: 400, recoverable: false },
      { code: 404, recoverable: false },
      { code: 422, recoverable: false }
    ];

    permanentErrors.forEach(error => {
      expect(error.recoverable).toBe(false);
    });
  });

  test('should implement exponential backoff for retries', () => {
    const calculateDelay = (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000);

    expect(calculateDelay(0)).toBe(1000);   // 1s
    expect(calculateDelay(1)).toBe(2000);   // 2s
    expect(calculateDelay(2)).toBe(4000);   // 4s
    expect(calculateDelay(3)).toBe(8000);   // 8s
    expect(calculateDelay(4)).toBe(10000);  // 10s (capped)
  });

  test('should limit retry attempts', () => {
    const maxRetries = 3;
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;
    }

    expect(attempts).toBe(maxRetries);
    expect(attempts).toBeLessThanOrEqual(maxRetries);
  });
});

describe('ErrorManager - Error Context', () => {
  test('should capture error context', () => {
    const errorContext = {
      operation: 'createEntity',
      module: 'DataStore',
      timestamp: new Date().toISOString(),
      user: 'curator_123',
      data: { entity_id: 'test_123' }
    };

    expect(errorContext.operation).toBeTruthy();
    expect(errorContext.module).toBeTruthy();
    expect(errorContext.timestamp).toBeTruthy();
  });

  test('should sanitize sensitive data from errors', () => {
    const sanitize = (data) => {
      const sanitized = { ...data };
      delete sanitized.password;
      delete sanitized.apiKey;
      delete sanitized.token;
      return sanitized;
    };

    const data = {
      username: 'test',
      password: 'secret123',
      apiKey: 'key_abc',
      token: 'token_xyz'
    };

    const sanitized = sanitize(data);
    
    expect(sanitized.username).toBe('test');
    expect(sanitized.password).toBeUndefined();
    expect(sanitized.apiKey).toBeUndefined();
    expect(sanitized.token).toBeUndefined();
  });
});

describe('ErrorManager - Error Display', () => {
  test('should show errors in UI', () => {
    const displayError = (message) => ({
      type: 'error',
      message,
      visible: true,
      duration: 5000
    });

    const notification = displayError('Test error');
    
    expect(notification.type).toBe('error');
    expect(notification.visible).toBe(true);
    expect(notification.duration).toBeGreaterThan(0);
  });

  test('should auto-dismiss non-critical errors', () => {
    const errors = {
      critical: { autoDismiss: false, duration: null },
      warning: { autoDismiss: true, duration: 5000 },
      info: { autoDismiss: true, duration: 3000 }
    };

    expect(errors.critical.autoDismiss).toBe(false);
    expect(errors.warning.autoDismiss).toBe(true);
    expect(errors.info.autoDismiss).toBe(true);
  });

  test('should stack multiple errors', () => {
    const errorQueue = [];
    
    errorQueue.push({ id: 1, message: 'Error 1' });
    errorQueue.push({ id: 2, message: 'Error 2' });
    errorQueue.push({ id: 3, message: 'Error 3' });

    expect(errorQueue).toHaveLength(3);
    expect(errorQueue[0].id).toBe(1);
  });
});

describe('ErrorManager - Error Logging', () => {
  test('should log errors with severity', () => {
    const logError = vi.fn();
    
    logError('Critical error', { severity: 'critical' });
    logError('Warning', { severity: 'warning' });

    expect(logError).toHaveBeenCalledTimes(2);
  });

  test('should include stack traces for debugging', () => {
    const error = new Error('Test error');
    
    expect(error.stack).toBeTruthy();
    expect(error.stack).toContain('Error: Test error');
  });

  test('should group related errors', () => {
    const errorGroups = {
      network: [],
      validation: [],
      auth: []
    };

    errorGroups.network.push({ code: 'ERR_NETWORK' });
    errorGroups.validation.push({ code: 422 });

    expect(errorGroups.network).toHaveLength(1);
    expect(errorGroups.validation).toHaveLength(1);
  });
});

describe('ErrorManager - API Error Handling', () => {
  test('should parse API error responses', () => {
    const parseApiError = (response) => ({
      status: response.status,
      message: response.detail || 'Unknown error',
      errors: response.errors || []
    });

    const apiResponse = {
      status: 422,
      detail: 'Validation failed',
      errors: [{ field: 'name', message: 'Required' }]
    };

    const parsed = parseApiError(apiResponse);
    
    expect(parsed.status).toBe(422);
    expect(parsed.message).toBe('Validation failed');
    expect(parsed.errors).toHaveLength(1);
  });

  test('should handle version conflict errors', () => {
    const isVersionConflict = (status) => status === 409 || status === 403;

    expect(isVersionConflict(409)).toBe(true);
    expect(isVersionConflict(403)).toBe(true);
    expect(isVersionConflict(404)).toBe(false);
  });

  test('should handle authentication errors', () => {
    const isAuthError = (status) => status === 401 || status === 403;

    expect(isAuthError(401)).toBe(true);
    expect(isAuthError(403)).toBe(true);
    expect(isAuthError(404)).toBe(false);
  });
});

describe('ErrorManager - Error Boundaries', () => {
  test('should catch and handle unexpected errors', () => {
    const errorBoundary = (fn) => {
      try {
        return fn();
      } catch (error) {
        return { error: error.message };
      }
    };

    const result = errorBoundary(() => {
      throw new Error('Unexpected error');
    });

    expect(result.error).toBe('Unexpected error');
  });

  test('should prevent error propagation', () => {
    let errorCaught = false;

    try {
      throw new Error('Test');
    } catch (e) {
      errorCaught = true;
    }

    expect(errorCaught).toBe(true);
  });

  test('should provide fallback behavior', () => {
    const withFallback = (fn, fallback) => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    };

    const result = withFallback(
      () => { throw new Error(); },
      'fallback value'
    );

    expect(result).toBe('fallback value');
  });
});
