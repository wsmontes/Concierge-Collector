/**
 * Curations Store
 * Purpose: Manage curation entities (recordings, transcriptions, notes)
 * Dependencies: Svelte stores, Dexie.js for persistence
 * 
 * Usage:
 *   import { curations, addCuration, updateCuration } from '$lib/stores/curations';
 *   $curations // access all curations
 *   addCuration(data) // create new curation
 *   updateCuration(id, updates) // update existing
 */

import { writable, derived } from 'svelte/store';

export interface Concept {
	category: string;
	name: string;
	confidence?: number;
}

export interface Curation {
	id: string;
	title: string;
	placeId?: string;
	placeName?: string;
	status: 'draft' | 'published';
	recordingUrl?: string;
	transcription?: string;
	concepts: Concept[];
	notes?: string;
	createdAt: string;
	updatedAt: string;
	publishedAt?: string;
}

// Create writable store
const curationsStore = writable<Curation[]>([]);

// Derived stores
export const publishedCurations = derived(
	curationsStore,
	$curations => $curations.filter(c => c.status === 'published')
);

export const draftCurations = derived(
	curationsStore,
	$curations => $curations.filter(c => c.status === 'draft')
);

export const recentCurations = derived(
	curationsStore,
	$curations => [...$curations]
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
		.slice(0, 10)
);

export const curationStats = derived(
	curationsStore,
	$curations => ({
		total: $curations.length,
		published: $curations.filter(c => c.status === 'published').length,
		draft: $curations.filter(c => c.status === 'draft').length
	})
);

// Actions
export function addCuration(curation: Omit<Curation, 'id' | 'createdAt' | 'updatedAt'>) {
	const newCuration: Curation = {
		...curation,
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};

	curationsStore.update(items => [...items, newCuration]);
	return newCuration;
}

export function updateCuration(id: string, updates: Partial<Curation>) {
	curationsStore.update(items =>
		items.map(item =>
			item.id === id
				? { ...item, ...updates, updatedAt: new Date().toISOString() }
				: item
		)
	);
}

export function deleteCuration(id: string) {
	curationsStore.update(items => items.filter(item => item.id !== id));
}

export function getCurationById(id: string) {
	let result: Curation | undefined;
	curationsStore.subscribe(items => {
		result = items.find(item => item.id === id);
	})();
	return result;
}

export function publishCuration(id: string) {
	updateCuration(id, {
		status: 'published',
		publishedAt: new Date().toISOString()
	});
}

// Export store
export const curations = curationsStore;
