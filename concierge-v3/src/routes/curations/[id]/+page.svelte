<!--
  Curation Detail Page
  Purpose: View a single curation with all details
  Route: /curations/[id]
  
  Features:
    - Transcription display
    - Extracted concepts
    - Notes and annotations
    - Edit/Delete actions
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { Header, Card, Badge, Chip, Button } from '$lib/components';

	const curationId = $page.params.id;

	// Mock data - will be replaced with real data from stores
	const curation = {
		id: curationId,
		title: 'Oteque - Rio de Janeiro',
		date: '2025-11-15',
		status: 'published',
		transcription: 'Incrível experiência no Oteque. O menu degustação de 8 tempos foi excepcional. Destaque para o prato de robalo com tucupi, que trouxe elementos da cozinha amazônica de forma contemporânea. O atendimento foi impecável, com sommeliers muito bem preparados. A carta de vinhos tem excelente curadoria.',
		concepts: [
			{ category: 'Ambiance', name: 'Contemporary', color: 'primary' },
			{ category: 'Food', name: 'Innovation', color: 'secondary' },
			{ category: 'Service', name: 'Professional', color: 'primary' }
		],
		notes: 'Reserva com 2 meses de antecedência. Menu degustação R$ 650/pessoa.'
	};
</script>

<Header title={curation.title} showBack>
	{#snippet actions()}
		<Button size="sm" variant="ghost" href="/curations/{curationId}/edit">
			Edit
		</Button>
	{/snippet}
</Header>

<main class="container mx-auto px-4 py-6 max-w-4xl space-y-6">
	<!-- Status & Date -->
	<div class="flex items-center gap-3">
		<Badge variant={curation.status === 'published' ? 'success' : 'warning'}>
			{curation.status}
		</Badge>
		<span class="text-sm text-neutral-500">
			{new Date(curation.date).toLocaleDateString('pt-BR', { 
				year: 'numeric', 
				month: 'long', 
				day: 'numeric' 
			})}
		</span>
	</div>

	<!-- Transcription -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Transcription</h2>
		<p class="text-neutral-700 leading-relaxed">
			{curation.transcription}
		</p>
	</Card>

	<!-- Extracted Concepts -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Extracted Concepts</h2>
		<div class="space-y-3">
			{#each curation.concepts as concept}
				<div>
					<p class="text-xs font-medium text-neutral-500 uppercase mb-2">
						{concept.category}
					</p>
					<Chip variant={concept.color} removable={false}>
						{concept.name}
					</Chip>
				</div>
			{/each}
		</div>
	</Card>

	<!-- Notes -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Notes</h2>
		<p class="text-neutral-700">
			{curation.notes}
		</p>
	</Card>

	<!-- Actions -->
	<div class="flex gap-3 pt-4">
		<Button fullWidth variant="secondary" href="/curations/{curationId}/edit">
			Edit Curation
		</Button>
		<Button variant="danger" onclick={() => confirm('Delete this curation?')}>
			Delete
		</Button>
	</div>
</main>
