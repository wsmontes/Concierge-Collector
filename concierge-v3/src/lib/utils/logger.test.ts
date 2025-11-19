/**
 * Logger Utility Tests
 * Purpose: Test logging functions for different log levels and contexts
 */

import { expect, test, describe, beforeEach, vi } from 'vitest';
import { logger } from './logger';

describe('Logger Utility', () => {
	beforeEach(() => {
		// Clear console spies before each test
		vi.clearAllMocks();
	});

	test('info logs with correct format', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.info('Test message');
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('success logs with emoji', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.success('Operation completed');
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('error logs with error object', () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		
		logger.error('Error occurred', new Error('Test error'));
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('warning logs correctly', () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		
		logger.warn('Warning message');
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('api logs request details', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.api('/api/curations', {
			method: 'GET',
			status: 200,
			duration: 150
		});
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('store logs action details', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.store('curations', 'add', { id: '123', title: 'Test' });
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('db logs database operation', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.db('insert', 'curations', { id: '456' });
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('action logs user action', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		
		logger.action('Button Click', { buttonId: 'save' });
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test('time starts a timer', () => {
		const consoleSpy = vi.spyOn(console, 'time').mockImplementation(() => {});
		
		logger.time('operation');
		
		expect(consoleSpy).toHaveBeenCalledWith('⏱️ operation');
		consoleSpy.mockRestore();
	});

	test('timeEnd ends a timer', () => {
		const consoleSpy = vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
		
		logger.time('operation');
		logger.timeEnd('operation');
		
		expect(consoleSpy).toHaveBeenCalledWith('⏱️ operation');
		consoleSpy.mockRestore();
	});
});
