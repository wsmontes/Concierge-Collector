<!--
  Edit Curation Page
  Purpose: Edit curation details, transcription, concepts
  Route: /curations/[id]/edit
  
  Features:
    - Edit title and notes
    - View/edit transcription
    - AI transcription from audio
    - AI concept extraction
    - Manage concepts (add/remove)
    - Publish or save draft
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { Header, Card, Input, Button, Chip, Badge, Modal } from '$lib/components';
	import { curations, updateCuration, publishCuration, type Concept } from '$lib/stores';
	import { db } from '$lib/services/database';
	import { apiClient } from '$lib/services/apiClient';
	import { blobToBase64 } from '$lib/utils/audio';
	import { logger } from '$lib/utils/logger';

	const curationId = $page.params.id;
	const curation = $derived($curations.find(c => c.id === curationId));

	let title = $state(curation?.title || '');
	let transcription = $state(curation?.transcription || '');
	let notes = $state(curation?.notes || '');
	let concepts = $state<Concept[]>(curation?.concepts || []);
	let showConceptModal = $state(false);
	let newConceptCategory = $state('');
	let newConceptName = $state('');
	let isTranscribing = $state(false);
	let isExtractingConcepts = $state(false);

	async function transcribeAudio() {
		if (!curation) return;

		logger.action('Transcribe Audio', { curationId });
		isTranscribing = true;
		logger.time('Transcription');
		
		try {
			// Get audio recording from IndexedDB
			logger.db('query', 'recordings', { curationId });
			const recordings = await db.recordings.where('curationId').equals(curationId).toArray();
			
			if (recordings.length === 0) {
				logger.error('No recording found', { curationId });
				alert('No audio recording found for this curation');
				return;
			}

			const recording = recordings[0];
			logger.info('Recording found', { duration: recording.duration, size: recording.audioBlob.size });
			
			// Convert blob to base64
			logger.time('Blob to Base64');
			const base64Audio = await blobToBase64(recording.audioBlob);
			logger.timeEnd('Blob to Base64');
			logger.info('Audio converted', { base64Length: base64Audio.length });

			// Call transcription API
			logger.api('/ai/transcribe', { method: 'POST' });
			const startTime = Date.now();
			const result = await apiClient.transcribeAudio(base64Audio, 'pt-BR');
			const duration = Date.now() - startTime;
			
			logger.api('/ai/transcribe', { method: 'POST', status: 200, duration });
			logger.success('Transcription complete', { textLength: result.text.length });
			
			transcription = result.text;
			
			// Save to curation
			logger.store('curations', 'update', { id: curationId, field: 'transcription' });
			updateCuration(curationId, { transcription });

			alert('Transcription complete! ✅');

		} catch (error: any) {
			logger.error('Transcription failed', error);
			console.error('Transcription error:', error);
			alert(error.message || 'Failed to transcribe audio. Check API key in settings.');
		} finally {
			logger.timeEnd('Transcription');
			isTranscribing = false;
		}
	}

	async function extractConcepts() {
		if (!transcription.trim()) {
			logger.warn('Extract concepts: No transcription available');
			alert('Please add transcription first');
			return;
		}

		logger.action('Extract Concepts', { textLength: transcription.length });
		isExtractingConcepts = true;
		logger.time('Concept Extraction');
		
		try {
			logger.api('/ai/extract-concepts', { method: 'POST', data: { entityType: 'restaurant' } });
			const startTime = Date.now();
			const result = await apiClient.extractConcepts(transcription, 'restaurant');
			const duration = Date.now() - startTime;
			
			logger.api('/ai/extract-concepts', { method: 'POST', status: 200, duration });
			logger.success('Concepts extracted', { count: result.concepts.length });
			
			// Merge with existing concepts (avoid duplicates)
			const newConcepts = result.concepts.filter(
				newC => !concepts.some(c => c.category === newC.category && c.name === newC.name)
			);

			if (newConcepts.length > 0) {
				concepts = [...concepts, ...newConcepts];
				logger.store('curations', 'add concepts', { count: newConcepts.length });
				alert(`Extracted ${newConcepts.length} new concepts! 🎯`);
			} else {
				logger.info('No new concepts found');
				alert('No new concepts found.');
			}

		} catch (error: any) {
			logger.error('Concept extraction failed', error);
			console.error('Concept extraction error:', error);
			alert(error.message || 'Failed to extract concepts. Check API key in settings.');
		} finally {
			logger.timeEnd('Concept Extraction');
			isExtractingConcepts = false;
		}
	}
	let showConceptModal = $state(false);
	let newConceptCategory = $state('');
	let newConceptName = $state('');

	function saveDraft() {
		if (!curation) return;
		
		updateCuration(curationId, {
			title,
			transcription,
			notes,
			concepts
		});

		alert('Draft saved!');
		goto('/curations');
	}

	function publish() {
		if (!title.trim()) {
			alert('Please add a title before publishing');
			return;
		}

		if (!curation) return;

		updateCuration(curationId, {
			title,
			transcription,
			notes,
			concepts
		});

		publishCuration(curationId);
		alert('Curation published!');
		goto(`/curations/${curationId}`);
	}

	function removeConcept(index: number) {
		concepts = concepts.filter((_, i) => i !== index);
	}

	function addConcept() {
		if (!newConceptCategory.trim() || !newConceptName.trim()) {
			alert('Please fill in both category and name');
			return;
		}

		concepts = [...concepts, {
			category: newConceptCategory,
			name: newConceptName
		}];

		newConceptCategory = '';
		newConceptName = '';
		showConceptModal = false;
	}

	// Common categories
	const categories = [
		'Ambiance', 'Service', 'Food', 'Cuisine', 
		'Experience', 'Value', 'Special'
	];
</script>

<Header title="Edit Curation" showBack>
	{#snippet actions()}
		<Button size="sm" variant="secondary" onclick={publish}>
			Publish
		</Button>
	{/snippet}
</Header>

<main class="container mx-auto px-4 py-6 max-w-4xl space-y-6">
	<!-- Title & Status -->
	<Card>
		<div class="flex items-start justify-between mb-4">
			<h2 class="text-xl font-bold text-neutral-900">Basic Info</h2>
			{#if curation}
				<Badge variant={curation.status === 'published' ? 'success' : 'warning'}>
					{curation.status}
				</Badge>
			{/if}
		</div>
		<Input
			label="Title"
			bind:value={title}
			placeholder="e.g., Oteque - Rio de Janeiro"
		/>
	</Card>

	<!-- Transcription -->
	<Card>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-bold text-neutral-900">Transcription</h2>
			{#if !transcription && !isTranscribing}
				<Button size="sm" onclick={transcribeAudio}>
					🎤 Transcribe
				</Button>
			{/if}
		</div>
		
		{#if isTranscribing}
			<div class="py-8 text-center">
				<div class="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent mx-auto mb-4"></div>
				<p class="text-neutral-600">Transcribing audio...</p>
				<p class="text-sm text-neutral-500 mt-2">This may take a minute</p>
			</div>
		{:else}
			<p class="text-sm text-neutral-600 mb-4">
				{#if !transcription}
					Click "Transcribe" to convert your audio recording to text automatically.
				{:else}
					Edit the transcription as needed
				{/if}
			</p>
			<textarea
				bind:value={transcription}
				placeholder="Your recording transcription will appear here, or you can type directly..."
				class="w-full px-4 py-3 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 min-h-[200px] resize-y"
			></textarea>
		{/if}
	</Card>

	<!-- Concepts -->
	<Card>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-bold text-neutral-900">Concepts</h2>
			<div class="flex gap-2">
				{#if transcription && !isExtractingConcepts}
					<Button size="sm" variant="secondary" onclick={extractConcepts}>
						🎯 Extract AI
					</Button>
				{/if}
				<Button size="sm" onclick={() => showConceptModal = true}>
					+ Add
				</Button>
			</div>
		</div>
		
		{#if isExtractingConcepts}
			<div class="py-8 text-center">
				<div class="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent mx-auto mb-4"></div>
				<p class="text-neutral-600">Extracting concepts with AI...</p>
			</div>
		{:else if concepts.length === 0}
			<div class="text-center py-8 border-2 border-dashed border-neutral-200 rounded-lg">
				<p class="text-neutral-500 mb-4">No concepts added yet</p>
				<Button variant="ghost" onclick={() => showConceptModal = true}>
					Add Your First Concept
				</Button>
			</div>
		{:else}
			<div class="space-y-4">
				{#each Object.entries(concepts.reduce((acc, concept) => {
					if (!acc[concept.category]) acc[concept.category] = [];
					acc[concept.category].push(concept);
					return acc;
				}, {} as Record<string, Concept[]>)) as [category, items], catIndex}
					<div>
						<p class="text-xs font-medium text-neutral-500 uppercase mb-2">
							{category}
						</p>
						<div class="flex flex-wrap gap-2">
							{#each items as concept, idx}
								{@const globalIdx = concepts.findIndex(c => c === concept)}
								<Chip variant="primary" onremove={() => removeConcept(globalIdx)}>
									{concept.name}
								</Chip>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card>

	<!-- Notes -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Additional Notes</h2>
		<textarea
			bind:value={notes}
			placeholder="Add any additional notes, tips, or recommendations..."
			class="w-full px-4 py-3 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 min-h-[120px] resize-y"
		></textarea>
	</Card>

	<!-- Actions -->
	<div class="flex gap-3 sticky bottom-4 bg-neutral-50 p-4 rounded-xl shadow-lg border border-neutral-200">
		<Button variant="ghost" fullWidth onclick={saveDraft}>
			Save Draft
		</Button>
		<Button variant="secondary" fullWidth onclick={publish}>
			Publish
		</Button>
	</div>
</main>

<!-- Add Concept Modal -->
<Modal bind:open={showConceptModal} title="Add Concept" size="sm">
	<div class="space-y-4">
		<div>
			<label class="block text-sm font-medium text-neutral-700 mb-2">
				Category
			</label>
			<div class="flex flex-wrap gap-2 mb-3">
				{#each categories as cat}
					<button
						onclick={() => newConceptCategory = cat}
						class="px-3 py-1.5 rounded-full text-sm transition-colors"
						class:bg-teal-100={newConceptCategory === cat}
						class:text-teal-800={newConceptCategory === cat}
						class:bg-neutral-100={newConceptCategory !== cat}
						class:text-neutral-700={newConceptCategory !== cat}
					>
						{cat}
					</button>
				{/each}
			</div>
			<Input
				bind:value={newConceptCategory}
				placeholder="Or type custom category"
			/>
		</div>

		<Input
			label="Concept Name"
			bind:value={newConceptName}
			placeholder="e.g., Contemporary, Innovative, Cozy"
		/>
	</div>
	
	{#snippet footer()}
		<div class="flex gap-3 justify-end">
			<Button variant="ghost" onclick={() => showConceptModal = false}>Cancel</Button>
			<Button variant="primary" onclick={addConcept}>Add Concept</Button>
		</div>
	{/snippet}
</Modal>
