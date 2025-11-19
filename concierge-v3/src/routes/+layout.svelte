<!--
  Root Layout
  Purpose: Main application layout with navigation
  Dependencies: BottomNav, Sidebar, DevTools components
  
  Features:
    - Mobile: Bottom navigation + full-width content
    - Desktop: Sidebar + content with 256px offset
    - Padding bottom on mobile to avoid nav overlap
    - DevTools panel for in-app debugging
-->
<script lang="ts">
	import '../app.css';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import DevTools from '$lib/components/DevTools.svelte';
	import { onMount } from 'svelte';
	import { seedData } from '$lib/utils/seedData';
	import { curations } from '$lib/stores';

	// Seed data on first load if empty
	onMount(() => {
		const unsub = curations.subscribe(items => {
			if (items.length === 0) {
				seedData();
			}
		});
		return unsub;
	});
</script>

<div class="min-h-screen bg-neutral-50">
	<!-- Desktop Sidebar (hidden on mobile) -->
	<Sidebar />

	<!-- Main Content -->
	<div class="md:ml-64 pb-16 md:pb-0">
		<slot />
	</div>

	<!-- Mobile Bottom Navigation (hidden on desktop) -->
	<BottomNav />

	<!-- DevTools (development console) -->
	<DevTools />
</div>
