/**
 * User Store
 * Purpose: Manage user authentication and profile data
 * Dependencies: Svelte stores, localStorage persistence
 * 
 * Usage:
 *   import { user, login, logout } from '$lib/stores/user';
 *   $user // access current user
 *   login(userData) // set user data
 *   logout() // clear user data
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

interface User {
	id: string;
	name: string;
	email: string;
	curatorId: string;
	apiKey: string;
	createdAt: string;
}

const STORAGE_KEY = 'concierge_user';

// Initialize from localStorage if in browser
function getInitialUser(): User | null {
	if (!browser) return null;
	
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : null;
	} catch (error) {
		console.error('Failed to load user from localStorage:', error);
		return null;
	}
}

// Create writable store
const userStore = writable<User | null>(getInitialUser());

// Subscribe to changes and persist to localStorage
if (browser) {
	userStore.subscribe(value => {
		if (value) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	});
}

// Derived store: is user authenticated?
export const isAuthenticated = derived(userStore, $user => $user !== null);

// Derived store: user initials for avatar
export const userInitials = derived(userStore, $user => {
	if (!$user) return 'U';
	return $user.name
		.split(' ')
		.map(n => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
});

// Actions
export function login(userData: User) {
	userStore.set(userData);
}

export function logout() {
	userStore.set(null);
}

export function updateUser(updates: Partial<User>) {
	userStore.update(current => {
		if (!current) return null;
		return { ...current, ...updates };
	});
}

// Export store
export const user = userStore;
