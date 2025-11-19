<!--
  Direct Test - bypassing all components
  Purpose: Test if onclick works without component wrappers
-->
<script lang="ts">
	let log = $state<string[]>([]);
	
	function addLog(msg: string) {
		log = [...log, `[${new Date().toLocaleTimeString()}] ${msg}`];
	}

	function handleDirectClick() {
		addLog('🎯 Direct button clicked!');
	}

	function handleInlineClick() {
		addLog('⚡ Inline arrow function clicked!');
	}
</script>

<svelte:head>
	<title>Direct Test</title>
</svelte:head>

<div class="min-h-screen bg-neutral-50 p-8">
	<div class="max-w-2xl mx-auto">
		<h1 class="text-3xl font-bold mb-6">🧪 Direct onclick Test</h1>
		
		<p class="mb-8 text-neutral-700">
			Testing onclick directly on button elements without any component wrappers.
		</p>

		<!-- Test 1: Direct function reference -->
		<div class="mb-6 p-6 bg-white rounded-lg shadow">
			<h2 class="text-xl font-semibold mb-4">Test 1: Direct Function Reference</h2>
			<button
				onclick={handleDirectClick}
				class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
			>
				Click Me (Direct Function)
			</button>
		</div>

		<!-- Test 2: Inline arrow function -->
		<div class="mb-6 p-6 bg-white rounded-lg shadow">
			<h2 class="text-xl font-semibold mb-4">Test 2: Inline Arrow Function</h2>
			<button
				onclick={() => handleInlineClick()}
				class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
			>
				Click Me (Inline Arrow)
			</button>
		</div>

		<!-- Test 3: Inline code -->
		<div class="mb-6 p-6 bg-white rounded-lg shadow">
			<h2 class="text-xl font-semibold mb-4">Test 3: Inline Code</h2>
			<button
				onclick={() => addLog('💥 Inline code clicked!')}
				class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
			>
				Click Me (Inline Code)
			</button>
		</div>

		<!-- Test 4: onclickcapture (not delegated) -->
		<div class="mb-6 p-6 bg-white rounded-lg shadow">
			<h2 class="text-xl font-semibold mb-4">Test 4: onclickcapture (Not Delegated)</h2>
			<button
				onclickcapture={() => addLog('🎣 Capture phase clicked!')}
				class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
			>
				Click Me (Capture)
			</button>
		</div>

		<!-- Log Output -->
		<div class="mt-8 p-6 bg-black text-green-400 rounded-lg shadow font-mono text-sm">
			<div class="flex justify-between items-center mb-4">
				<h3 class="text-lg font-bold">📋 Log Output</h3>
				<button
					onclick={() => log = []}
					class="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
				>
					Clear
				</button>
			</div>
			
			{#if log.length === 0}
				<p class="text-neutral-500">No events yet... Click a button above!</p>
			{:else}
				<div class="space-y-1 max-h-96 overflow-y-auto">
					{#each log as entry}
						<div>{entry}</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Inspector -->
		<div class="mt-6 p-6 bg-white rounded-lg shadow">
			<h3 class="text-lg font-semibold mb-4">🔍 DOM Inspector</h3>
			<button
				onclick={() => {
					const buttons = document.querySelectorAll('button');
					addLog('─────────────────────────');
					addLog(`Found ${buttons.length} buttons total`);
					
					buttons.forEach((btn, i) => {
						const text = btn.textContent?.trim().substring(0, 30) || 'Unknown';
						const hasOnclick = btn.onclick !== null;
						const hasAttr = btn.hasAttribute('onclick');
						
						addLog(`Button ${i + 1}: "${text}"`);
						addLog(`  onclick: ${hasOnclick ? '✅' : '❌'}`);
						addLog(`  attribute: ${hasAttr ? '✅' : '❌'}`);
					});
				}}
				class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
			>
				Inspect All Buttons
			</button>
		</div>

		<!-- Navigation -->
		<div class="mt-6 flex gap-3">
			<button
				onclick={() => window.location.href = '/test-click'}
				class="px-4 py-2 bg-neutral-700 text-white rounded-lg hover:bg-neutral-800"
			>
				← Back to Click Test
			</button>
			<button
				onclick={() => window.location.href = '/'}
				class="px-4 py-2 bg-neutral-700 text-white rounded-lg hover:bg-neutral-800"
			>
				← Home
			</button>
		</div>
	</div>
</div>
