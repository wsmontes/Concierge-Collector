/**
 * Dexie Database Service
 * Purpose: IndexedDB wrapper for offline-first data storage
 * Dependencies: Dexie.js
 * 
 * Schema v1:
 *   - curations: id, title, status, createdAt, updatedAt (indexed)
 *   - places: id, name, address, googlePlaceId
 *   - recordings: id, curationId, audioBlob, duration
 * 
 * Usage:
 *   import { db } from '$lib/services/database';
 *   await db.curations.add(curation);
 *   const all = await db.curations.toArray();
 */

import Dexie, { type Table } from 'dexie';

export interface DBCuration {
	id: string;
	title: string;
	placeId?: string;
	placeName?: string;
	status: 'draft' | 'published';
	recordingUrl?: string;
	transcription?: string;
	concepts: string; // JSON stringified
	notes?: string;
	createdAt: string;
	updatedAt: string;
	publishedAt?: string;
}

export interface DBPlace {
	id: string;
	name: string;
	address?: string;
	googlePlaceId?: string;
	cuisine?: string;
	priceLevel?: string;
	rating?: number;
	createdAt: string;
}

export interface DBRecording {
	id: string;
	curationId: string;
	audioBlob: Blob;
	duration: number;
	mimeType: string;
	createdAt: string;
}

export interface DBSync {
	id: string;
	entityType: 'curation' | 'place' | 'recording';
	entityId: string;
	action: 'create' | 'update' | 'delete';
	data: string; // JSON stringified
	synced: boolean;
	createdAt: string;
	syncedAt?: string;
}

class ConciergeDatabase extends Dexie {
	curations!: Table<DBCuration, string>;
	places!: Table<DBPlace, string>;
	recordings!: Table<DBRecording, string>;
	syncQueue!: Table<DBSync, string>;

	constructor() {
		super('ConciergeCollectorV3');

		// Schema v1
		this.version(1).stores({
			curations: 'id, status, createdAt, updatedAt, publishedAt',
			places: 'id, name, googlePlaceId, createdAt',
			recordings: 'id, curationId, createdAt',
			syncQueue: 'id, entityType, entityId, synced, createdAt'
		});
	}
}

export const db = new ConciergeDatabase();

// Helper functions
export async function saveCurationToDb(curation: any) {
	const dbCuration: DBCuration = {
		...curation,
		concepts: JSON.stringify(curation.concepts)
	};
	await db.curations.put(dbCuration);
}

export async function loadCurationsFromDb() {
	const dbCurations = await db.curations.toArray();
	return dbCurations.map(c => ({
		...c,
		concepts: JSON.parse(c.concepts)
	}));
}

export async function deleteCurationFromDb(id: string) {
	await db.curations.delete(id);
	// Also delete associated recordings
	const recordings = await db.recordings.where('curationId').equals(id).toArray();
	await Promise.all(recordings.map(r => db.recordings.delete(r.id)));
}

export async function addToSyncQueue(
	entityType: DBSync['entityType'],
	entityId: string,
	action: DBSync['action'],
	data: any
) {
	await db.syncQueue.add({
		id: crypto.randomUUID(),
		entityType,
		entityId,
		action,
		data: JSON.stringify(data),
		synced: false,
		createdAt: new Date().toISOString()
	});
}

export async function getPendingSyncs() {
	return await db.syncQueue.where('synced').equals(0).toArray();
}

export async function markSyncComplete(syncId: string) {
	await db.syncQueue.update(syncId, {
		synced: true,
		syncedAt: new Date().toISOString()
	});
}
