<!--
  Places Search Page
  Purpose: Search for restaurants/places to curate
  Route: /places
  
  Features:
    - Search input
    - Google Places integration (future)
    - Recent searches
    - Quick add to curation
-->
<script lang="ts">
	import { Header, Card, Input, Badge, Button } from '$lib/components';

	let searchQuery = $state('');

	// Mock data - will be replaced with Google Places API
	const places = [
		{
			id: 1,
			name: 'Oteque',
			address: 'Rua Corcovado, 310 - Rio de Janeiro',
			rating: 4.8,
			priceLevel: '$$$',
			cuisine: 'Contemporary Brazilian'
		},
		{
			id: 2,
			name: 'D.O.M.',
			address: 'Rua Barão de Capanema, 549 - São Paulo',
			rating: 4.9,
			priceLevel: '$$$$',
			cuisine: 'Fine Dining'
		},
		{
			id: 3,
			name: 'Lasai',
			address: 'Rua Conde de Irajá, 191 - Rio de Janeiro',
			rating: 4.7,
			priceLevel: '$$$',
			cuisine: 'Farm to Table'
		}
	];

	function handleSearch() {
		console.log('Searching for:', searchQuery);
		// Will integrate with Google Places API
	}
</script>

<Header title="Find Places" />

<main class="container mx-auto px-4 py-6 max-w-4xl">
	<!-- Search Input -->
	<div class="mb-6">
		<Input
			bind:value={searchQuery}
			placeholder="Search restaurants, bars, cafes..."
			type="search"
		/>
		<Button fullWidth class="mt-3" onclick={handleSearch}>
			Search
		</Button>
	</div>

	<!-- Recent/Popular Places -->
	<div>
		<h2 class="text-lg font-bold mb-4 text-neutral-900">Popular Places</h2>
		<div class="space-y-4">
			{#each places as place}
				<Card hoverable>
					<div class="flex justify-between items-start mb-3">
						<div class="flex-1 min-w-0">
							<h3 class="text-lg font-bold text-neutral-900 mb-1">
								{place.name}
							</h3>
							<p class="text-sm text-neutral-600 mb-2">
								{place.address}
							</p>
							<div class="flex items-center gap-2 mb-2">
								<Badge variant="secondary" size="sm">
									⭐ {place.rating}
								</Badge>
								<Badge variant="neutral" size="sm">
									{place.priceLevel}
								</Badge>
							</div>
							<p class="text-sm text-neutral-500">
								{place.cuisine}
							</p>
						</div>
					</div>
					<Button size="sm" fullWidth>
						+ Create Curation
					</Button>
				</Card>
			{/each}
		</div>
	</div>
</main>
