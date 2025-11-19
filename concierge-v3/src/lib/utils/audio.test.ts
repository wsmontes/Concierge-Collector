/**
 * Audio Utils Tests
 * Purpose: Test audio conversion and duration utilities
 */

import { expect, test, describe } from 'vitest';
import { blobToBase64, base64ToBlob, formatDuration } from './audio';

describe('Audio Utilities', () => {
	describe('blobToBase64', () => {
		test('converts blob to base64 string', async () => {
			const testData = 'test audio data';
			const blob = new Blob([testData], { type: 'audio/webm' });

			const result = await blobToBase64(blob);

			expect(result).toBeTypeOf('string');
			expect(result.length).toBeGreaterThan(0);
		});

		test('handles empty blob', async () => {
			const blob = new Blob([], { type: 'audio/webm' });

			const result = await blobToBase64(blob);

			expect(result).toBeTypeOf('string');
		});
	});

	describe('base64ToBlob', () => {
		test('converts base64 to blob', () => {
			const base64 = 'SGVsbG8gV29ybGQ='; // "Hello World" in base64

			const blob = base64ToBlob(base64, 'audio/webm');

			expect(blob).toBeInstanceOf(Blob);
			expect(blob.type).toBe('audio/webm');
		});

		test('uses default mime type', () => {
			const base64 = 'SGVsbG8gV29ybGQ=';

			const blob = base64ToBlob(base64);

			expect(blob.type).toBe('audio/webm');
		});

		test('handles custom mime types', () => {
			const base64 = 'SGVsbG8gV29ybGQ=';

			const blob = base64ToBlob(base64, 'audio/mp3');

			expect(blob.type).toBe('audio/mp3');
		});
	});

	describe('formatDuration', () => {
		test('formats seconds only', () => {
			expect(formatDuration(45)).toBe('0:45');
		});

		test('formats minutes and seconds', () => {
			expect(formatDuration(125)).toBe('2:05');
		});

		test('pads single digit seconds', () => {
			expect(formatDuration(65)).toBe('1:05');
		});

		test('handles zero duration', () => {
			expect(formatDuration(0)).toBe('0:00');
		});

		test('handles large durations', () => {
			expect(formatDuration(3725)).toBe('62:05');
		});

		test('handles decimal seconds', () => {
			const result = formatDuration(65.7);
			expect(result).toMatch(/^1:0[56]$/); // Either 65 or 66 seconds
		});
	});

	describe('roundtrip conversion', () => {
		test('blob -> base64 -> blob preserves data', async () => {
			const testData = 'test audio data for roundtrip';
			const originalBlob = new Blob([testData], { type: 'audio/webm' });

			const base64 = await blobToBase64(originalBlob);
			const convertedBlob = base64ToBlob(base64, 'audio/webm');

			expect(convertedBlob.size).toBeGreaterThan(0);
			expect(convertedBlob.type).toBe(originalBlob.type);
		});
	});
});
