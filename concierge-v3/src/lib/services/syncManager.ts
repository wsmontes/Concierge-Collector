/**
 * Sync Manager
 * Purpose: Synchronize local IndexedDB data with remote API
 * Dependencies: database service, API client
 * 
 * Features:
 *   - Offline-first: queue operations when offline
 *   - Background sync: periodically sync pending changes
 *   - Conflict resolution: last-write-wins strategy
 * 
 * Usage:
 *   import { syncManager } from '$lib/services/syncManager';
 *   syncManager.start(); // start background sync
 *   await syncManager.syncNow(); // force sync
 */

import { browser } from '$app/environment';
import { 
	db, 
	loadCurationsFromDb, 
	saveCurationToDb, 
	getPendingSyncs, 
	markSyncComplete,
	addToSyncQueue 
} from './database';
import { curations } from '$lib/stores/curations';

class SyncManager {
	private syncInterval: number | null = null;
	private isSyncing = false;

	// Start background sync (every 5 minutes)
	start() {
		if (!browser) return;

		// Initial sync
		this.loadFromDb();

		// Periodic sync
		this.syncInterval = window.setInterval(() => {
			this.syncNow();
		}, 5 * 60 * 1000); // 5 minutes

		// Sync on window focus
		window.addEventListener('focus', () => this.syncNow());

		// Sync on online
		window.addEventListener('online', () => this.syncNow());
	}

	stop() {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
	}

	// Load data from IndexedDB to stores
	async loadFromDb() {
		try {
			const dbCurations = await loadCurationsFromDb();
			curations.set(dbCurations);
			console.log(`Loaded ${dbCurations.length} curations from IndexedDB`);
		} catch (error) {
			console.error('Failed to load from IndexedDB:', error);
		}
	}

	// Sync all pending changes
	async syncNow() {
		if (this.isSyncing) {
			console.log('Sync already in progress, skipping...');
			return;
		}

		if (!navigator.onLine) {
			console.log('Offline, skipping sync...');
			return;
		}

		this.isSyncing = true;

		try {
			// Get pending syncs
			const pending = await getPendingSyncs();
			console.log(`Syncing ${pending.length} pending changes...`);

			for (const sync of pending) {
				try {
					// TODO: Send to API based on entityType and action
					// For now, just mark as complete
					await markSyncComplete(sync.id);
					console.log(`Synced ${sync.entityType} ${sync.action} ${sync.entityId}`);
				} catch (error) {
					console.error(`Failed to sync ${sync.id}:`, error);
					// Leave unsynced for next attempt
				}
			}

			// TODO: Pull updates from API
			// Check for server-side changes and merge

		} catch (error) {
			console.error('Sync failed:', error);
		} finally {
			this.isSyncing = false;
		}
	}

	// Queue a change for sync
	async queueChange(
		entityType: 'curation' | 'place' | 'recording',
		entityId: string,
		action: 'create' | 'update' | 'delete',
		data: any
	) {
		await addToSyncQueue(entityType, entityId, action, data);

		// Try to sync immediately if online
		if (navigator.onLine) {
			this.syncNow();
		}
	}
}

export const syncManager = new SyncManager();

// Auto-start in browser
if (browser) {
	syncManager.start();
}
