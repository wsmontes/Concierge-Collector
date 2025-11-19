/**
 * Audio Utilities
 * Purpose: Helper functions for audio processing
 * Dependencies: None (native Web APIs)
 * 
 * Features:
 *   - Convert Blob to Base64
 *   - Audio format detection
 *   - Duration calculation
 */

export async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const base64 = reader.result as string;
			// Remove data URL prefix (e.g., "data:audio/webm;base64,")
			const base64Data = base64.split(',')[1];
			resolve(base64Data);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

export function base64ToBlob(base64: string, mimeType: string = 'audio/webm'): Blob {
	const byteCharacters = atob(base64);
	const byteNumbers = new Array(byteCharacters.length);
	
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	
	const byteArray = new Uint8Array(byteNumbers);
	return new Blob([byteArray], { type: mimeType });
}

export async function getAudioDuration(blob: Blob): Promise<number> {
	return new Promise((resolve, reject) => {
		const audio = new Audio();
		const url = URL.createObjectURL(blob);
		
		audio.addEventListener('loadedmetadata', () => {
			URL.revokeObjectURL(url);
			resolve(audio.duration);
		});
		
		audio.addEventListener('error', () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load audio'));
		});
		
		audio.src = url;
	});
}

export function formatDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
