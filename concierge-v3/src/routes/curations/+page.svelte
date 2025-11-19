<!--
  Curations List Page
  Purpose: Display user's curations (recordings/transcriptions)
  Route: /curations
  
  Features:
    - List of all curations
    - Filter by status (published, draft)
    - Search functionality
    - Create new curation button
-->
<script lang="ts">
	import { Header, Card, Badge, Button } from '$lib/components';
	import { curations, publishedCurations, draftCurations } from '$lib/stores';

	let filter = $state<'all' | 'published' | 'draft'>('all');

	const filteredCurations = $derived(() => {
		switch (filter) {
			case 'published':
				return $publishedCurations;
			case 'draft':
				return $draftCurations;
			default:
				return $curations;
		}
	});
</script>

<Header title="My Curations">
	{#snippet actions()}
		<Button size="sm" href="/curations/new">
			+ New
		</Button>
	{/snippet}
</Header>

<main class="container mx-auto px-4 py-6 max-w-4xl">
	<!-- Filters -->
	<div class="flex gap-3 mb-6 overflow-x-auto pb-2">
		<Button 
			variant={filter === 'all' ? 'primary' : 'ghost'} 
			size="sm"
			onclick={() => filter = 'all'}
		>
			All ({$curations.length})
		</Button>
		<Button 
			variant={filter === 'published' ? 'primary' : 'ghost'} 
			size="sm"
			onclick={() => filter = 'published'}
		>
			Published ({$publishedCurations.length})
		</Button>
		<Button 
			variant={filter === 'draft' ? 'primary' : 'ghost'} 
			size="sm"
			onclick={() => filter = 'draft'}
		>
			Draft ({$draftCurations.length})
		</Button>
	</div>

	<!-- Curations List -->
	{#if filteredCurations().length === 0}
		<Card padding="lg">
			<div class="text-center py-8">
				<p class="text-4xl mb-4">📝</p>
				<p class="text-lg font-semibold text-neutral-900 mb-2">No curations found</p>
				<p class="text-neutral-600 mb-6">
					{filter === 'all' ? 'Create your first curation' : `No ${filter} curations yet`}
				</p>
				<Button variant="secondary" href="/curations/new">
					+ New Curation
				</Button>
			</div>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each filteredCurations() as curation}
				<Card hoverable clickable onclick={() => window.location.href = `/curations/${curation.id}`}>
					<div class="flex items-start justify-between mb-3">
						<div class="flex-1 min-w-0">
							<h3 class="text-lg font-bold text-neutral-900 truncate mb-1">
								{curation.title}
							</h3>
							<p class="text-sm text-neutral-500">
								{new Date(curation.createdAt).toLocaleDateString('pt-BR')}
							</p>
						</div>
						<Badge variant={curation.status === 'published' ? 'success' : 'warning'}>
							{curation.status}
						</Badge>
					</div>

					{#if curation.transcription}
						<p class="text-sm text-neutral-700 mb-4 line-clamp-2">
							{curation.transcription}
						</p>
					{/if}

					<div class="flex flex-wrap gap-2">
						{#each curation.concepts.slice(0, 5) as concept}
							<Badge variant="primary" size="sm">
								{concept.name}
							</Badge>
						{/each}
						{#if curation.concepts.length > 5}
							<Badge variant="neutral" size="sm">
								+{curation.concepts.length - 5} more
							</Badge>
						{/if}
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</main>
