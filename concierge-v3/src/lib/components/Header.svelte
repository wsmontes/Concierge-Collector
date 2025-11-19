<!--
  Header Component
  Purpose: Top app bar with title, search, and actions
  Dependencies: Design system
  
  Usage:
    <Header title="Dashboard" />
    <Header title="My Curations" actions={true} />
  
  Features:
    - Mobile: Title + optional actions
    - Desktop: Hidden (sidebar shows logo)
    - Sticky positioning
-->
<script lang="ts">
	interface Props {
		title?: string;
		showBack?: boolean;
		children?: import('svelte').Snippet;
		actions?: import('svelte').Snippet;
	}

	let {
		title = '',
		showBack = false,
		children,
		actions
	}: Props = $props();

	function handleBack() {
		window.history.back();
	}
</script>

<header class="sticky top-0 z-20 bg-white border-b border-neutral-200 md:ml-64">
	<div class="flex items-center justify-between h-16 px-4">
		<!-- Left: Back button or title -->
		<div class="flex items-center gap-3 flex-1 min-w-0">
			{#if showBack}
				<button
					onclick={handleBack}
					class="p-2 -ml-2 rounded-lg hover:bg-neutral-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
					aria-label="Go back"
				>
					<svg class="w-6 h-6 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
			{/if}
			
			{#if title}
				<h1 class="text-xl font-bold text-neutral-900 truncate">
					{title}
				</h1>
			{/if}
			
			{#if children}
				{@render children()}
			{/if}
		</div>

		<!-- Right: Actions -->
		{#if actions}
			<div class="flex items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</header>
