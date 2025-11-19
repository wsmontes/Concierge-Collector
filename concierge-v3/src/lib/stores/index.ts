/**
 * Store Index
 * Purpose: Central export for all stores
 * Dependencies: Individual store files
 * 
 * Usage:
 *   import { user, curations, isAuthenticated } from '$lib/stores';
 */

export { 
	user, 
	isAuthenticated, 
	userInitials,
	login, 
	logout, 
	updateUser 
} from './user';

export { 
	curations,
	publishedCurations,
	draftCurations,
	recentCurations,
	curationStats,
	addCuration,
	updateCuration,
	deleteCuration,
	getCurationById,
	publishCuration,
	type Curation,
	type Concept
} from './curations';
