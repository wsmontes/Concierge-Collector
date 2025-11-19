<!--
  Dashboard / Home Page
  Purpose: Overview of recent curations and quick actions
  Route: /
  
  Features:
    - Recent curations
    - Quick stats
    - Quick action button (new recording)
-->
<script lang="ts">
	import { Header, Card, Badge, Button } from '$lib/components';
	import { curationStats, recentCurations } from '$lib/stores';
</script>

<Header title="Dashboard">
	{#snippet actions()}
		<Button size="sm" variant="secondary" href="/curations/new">
			+ Record
		</Button>
	{/snippet}
</Header>

<main class="container mx-auto px-4 py-6 max-w-4xl">
	<!-- Stats Cards -->
	<div class="grid grid-cols-3 gap-4 mb-8">
		<Card padding="md">
			<p class="text-2xl font-bold text-teal-600 mb-1">
				{$curationStats.total}
			</p>
			<p class="text-xs text-neutral-600">Total</p>
		</Card>
		<Card padding="md">
			<p class="text-2xl font-bold text-green-600 mb-1">
				{$curationStats.published}
			</p>
			<p class="text-xs text-neutral-600">Published</p>
		</Card>
		<Card padding="md">
			<p class="text-2xl font-bold text-amber-600 mb-1">
				{$curationStats.draft}
			</p>
			<p class="text-xs text-neutral-600">Draft</p>
		</Card>
	</div>

	<!-- Recent Curations -->
	<section>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-bold text-neutral-900">Recent Curations</h2>
			<a href="/curations" class="text-sm text-teal-600 font-semibold hover:text-teal-700">
				View All →
			</a>
		</div>

		{#if $recentCurations.length === 0}
			<Card padding="lg">
				<div class="text-center py-8">
					<p class="text-4xl mb-4">🎙️</p>
					<p class="text-lg font-semibold text-neutral-900 mb-2">No curations yet</p>
					<p class="text-neutral-600 mb-6">Start by recording your first restaurant experience</p>
					<Button variant="secondary" href="/curations/new">
						Create First Curation
					</Button>
				</div>
			</Card>
		{:else}
			<div class="space-y-3">
				{#each $recentCurations as curation}
					<Card hoverable clickable onclick={() => window.location.href = `/curations/${curation.id}`}>
						<div class="flex items-center justify-between">
							<div class="flex-1 min-w-0">
								<h3 class="font-semibold text-neutral-900 truncate mb-1">
									{curation.title}
								</h3>
								<div class="flex items-center gap-2 text-sm">
									<span class="text-neutral-500">
										{new Date(curation.createdAt).toLocaleDateString('pt-BR')}
									</span>
									<span class="text-neutral-400">•</span>
									<span class="text-neutral-500">
										{curation.concepts.length} concepts
									</span>
								</div>
							</div>
							<Badge variant={curation.status === 'published' ? 'success' : 'warning'} size="sm">
								{curation.status}
							</Badge>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Quick Actions -->
	<section class="mt-8">
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Quick Actions</h2>
		<div class="grid grid-cols-2 gap-4">
			<Button variant="secondary" fullWidth href="/curations/new">
				🎙️ New Recording
			</Button>
			<Button variant="ghost" fullWidth href="/places">
				🔍 Find Places
			</Button>
		</div>
	</section>
</main>
