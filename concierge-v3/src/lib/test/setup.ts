/**
 * Vitest Setup File
 * Purpose: Configure testing environment and global test utilities
 */

import '@testing-library/jest-dom/vitest';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// Cleanup after each test
afterEach(() => {
	cleanup();
});
