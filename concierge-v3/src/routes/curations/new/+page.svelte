<!--
  New Curation Page
  Purpose: Create new curation with audio recording
  Route: /curations/new
  
  Features:
    - Audio recording
    - Place selection/search
    - Save as draft
    - Navigate to edit after recording
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { Header, Card, Input, Button, Modal } from '$lib/components';
	import RecordButton from '$lib/components/RecordButton.svelte';
	import { addCuration } from '$lib/stores';
	import { db } from '$lib/services/database';

	let placeName = $state('');
	let showPlaceModal = $state(false);
	let isProcessing = $state(false);

	async function handleRecordingComplete(audioBlob: Blob, duration: number) {
		isProcessing = true;

		try {
			// Create new curation
			const curation = addCuration({
				title: placeName || 'Untitled Curation',
				placeName: placeName || undefined,
				status: 'draft',
				concepts: [],
				notes: '',
				publishedAt: undefined
			});

			// Save audio recording to IndexedDB
			await db.recordings.add({
				id: crypto.randomUUID(),
				curationId: curation.id,
				audioBlob,
				duration,
				mimeType: audioBlob.type,
				createdAt: new Date().toISOString()
			});

			console.log('Recording saved:', curation.id);

			// Navigate to edit page for transcription
			goto(`/curations/${curation.id}/edit`);

		} catch (error) {
			console.error('Failed to save recording:', error);
			alert('Failed to save recording. Please try again.');
		} finally {
			isProcessing = false;
		}
	}

	function openPlaceSelector() {
		showPlaceModal = true;
	}
</script>

<Header title="New Curation" showBack />

<main class="container mx-auto px-4 py-6 max-w-2xl">
	<!-- Place Selection -->
	<Card class="mb-8">
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Restaurant/Place</h2>
		<p class="text-sm text-neutral-600 mb-4">
			Optional: Add the place name before recording
		</p>
		<Input
			bind:value={placeName}
			placeholder="e.g., Oteque - Rio de Janeiro"
			label="Place Name"
		/>
		<Button variant="ghost" class="mt-3" onclick={openPlaceSelector}>
			🔍 Search Places
		</Button>
	</Card>

	<!-- Recording Section -->
	<Card class="text-center py-8">
		<h2 class="text-xl font-bold mb-2 text-neutral-900">Record Your Experience</h2>
		<p class="text-sm text-neutral-600 mb-8">
			Share your thoughts about the food, ambiance, service, and overall experience
		</p>

		{#if isProcessing}
			<div class="py-8">
				<div class="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent mx-auto mb-4"></div>
				<p class="text-neutral-600">Processing recording...</p>
			</div>
		{:else}
			<RecordButton onrecordingcomplete={handleRecordingComplete} maxDuration={300} />
		{/if}

		<div class="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
			<p class="text-sm text-amber-900">
				<strong>💡 Tip:</strong> Speak naturally about what stood out. Mention specific dishes, 
				the ambiance, service quality, and overall impression. Max 5 minutes.
			</p>
		</div>
	</Card>
</main>

<!-- Place Search Modal -->
<Modal bind:open={showPlaceModal} title="Search Places" size="md">
	<div class="space-y-4">
		<Input
			placeholder="Search restaurants..."
			type="search"
		/>
		<p class="text-sm text-neutral-500 text-center py-8">
			Google Places integration coming soon...
		</p>
	</div>
	
	{#snippet footer()}
		<div class="flex gap-3 justify-end">
			<Button variant="ghost" onclick={() => showPlaceModal = false}>Close</Button>
		</div>
	{/snippet}
</Modal>
