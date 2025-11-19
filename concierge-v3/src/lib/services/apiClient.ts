/**
 * API Client Service
 * Purpose: HTTP client for Concierge API V3
 * Dependencies: None (native fetch)
 * 
 * Base URL: https://wsmontes.pythonanywhere.com/api/v3
 * Local Dev: http://localhost:8000/api/v3
 * 
 * Features:
 *   - X-API-Key authentication for AI endpoints
 *   - ETag support for optimistic locking
 *   - Error handling and retries
 *   - TypeScript types
 */

import { browser } from '$app/environment';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://wsmontes.pythonanywhere.com/api/v3';
const API_KEY_STORAGE_KEY = 'concierge_api_key_v3';

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public response?: any
	) {
		super(message);
		this.name = 'ApiError';
	}
}

class ApiClient {
	private baseUrl: string;
	private apiKey: string | null = null;

	constructor() {
		this.baseUrl = API_BASE_URL;
		
		// Load API key from localStorage if in browser
		if (browser) {
			this.apiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
		}
	}

	setApiKey(key: string) {
		this.apiKey = key;
		if (browser) {
			localStorage.setItem(API_KEY_STORAGE_KEY, key);
		}
	}

	getApiKey(): string | null {
		return this.apiKey;
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...(options.headers as Record<string, string>)
		};

		// Add API key if available (required for AI endpoints)
		if (this.apiKey) {
			headers['X-API-Key'] = this.apiKey;
		}

		try {
			const response = await fetch(url, {
				...options,
				headers
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
				throw new ApiError(
					error.detail || `HTTP ${response.status}`,
					response.status,
					error
				);
			}

			// Return ETag if present (for optimistic locking)
			const etag = response.headers.get('ETag');
			const data = await response.json();
			
			if (etag) {
				return { ...data, _etag: etag } as T;
			}

			return data;
		} catch (error) {
			if (error instanceof ApiError) {
				throw error;
			}
			throw new ApiError(
				error instanceof Error ? error.message : 'Network error',
				0
			);
		}
	}

	// System endpoints
	async getHealth() {
		return this.request<{ status: string }>('/health');
	}

	async getInfo() {
		return this.request<{ version: string; api_version: string }>('/info');
	}

	// Entity endpoints
	async createEntity(data: any) {
		return this.request('/entities', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	}

	async getEntity(id: string) {
		return this.request(`/entities/${id}`);
	}

	async updateEntity(id: string, data: any, etag?: string) {
		const headers: HeadersInit = {};
		if (etag) {
			headers['If-Match'] = etag;
		}
		
		return this.request(`/entities/${id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(data)
		});
	}

	async deleteEntity(id: string) {
		return this.request(`/entities/${id}`, {
			method: 'DELETE'
		});
	}

	async searchEntities(params: { type?: string; name?: string; category?: string }) {
		const query = new URLSearchParams(params as any).toString();
		return this.request<any[]>(`/entities?${query}`);
	}

	// Curation endpoints
	async createCuration(data: any) {
		return this.request('/curations', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	}

	async getCuration(id: string) {
		return this.request(`/curations/${id}`);
	}

	async updateCuration(id: string, data: any, etag?: string) {
		const headers: HeadersInit = {};
		if (etag) {
			headers['If-Match'] = etag;
		}
		
		return this.request(`/curations/${id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(data)
		});
	}

	async deleteCuration(id: string) {
		return this.request(`/curations/${id}`, {
			method: 'DELETE'
		});
	}

	async getEntityCurations(entityId: string) {
		return this.request<any[]>(`/entities/${entityId}/curations`);
	}

	// AI endpoints (require API key)
	async transcribeAudio(audioBase64: string, language: string = 'pt-BR') {
		if (!this.apiKey) {
			throw new ApiError('API key required for transcription', 401);
		}

		return this.request<{ text: string; language: string; duration?: number }>('/ai/transcribe', {
			method: 'POST',
			body: JSON.stringify({
				audio_file: audioBase64,
				language
			})
		});
	}

	async extractConcepts(text: string, entityType: string = 'restaurant') {
		if (!this.apiKey) {
			throw new ApiError('API key required for concept extraction', 401);
		}

		return this.request<{ concepts: Array<{ category: string; name: string; confidence: number }> }>(
			'/ai/extract-concepts',
			{
				method: 'POST',
				body: JSON.stringify({
					text,
					entity_type: entityType
				})
			}
		);
	}

	async analyzeImage(imageBase64: string, prompt: string = 'Describe this restaurant image') {
		if (!this.apiKey) {
			throw new ApiError('API key required for image analysis', 401);
		}

		return this.request<{ description: string }>('/ai/analyze-image', {
			method: 'POST',
			body: JSON.stringify({
				image_file: imageBase64,
				prompt
			})
		});
	}

	// Concepts endpoints
	async getConceptsForType(entityType: string) {
		return this.request<any[]>(`/concepts/${entityType}`);
	}

	async getAllConcepts() {
		return this.request<any[]>('/concepts/');
	}

	// Places endpoints (Google Places proxy)
	async searchNearbyPlaces(params: {
		latitude: number;
		longitude: number;
		radius?: number;
		type?: string;
		keyword?: string;
	}) {
		const query = new URLSearchParams(params as any).toString();
		return this.request<any[]>(`/places/nearby?${query}`);
	}

	async getPlaceDetails(placeId: string) {
		return this.request(`/places/details/${placeId}`);
	}
}

export const apiClient = new ApiClient();
