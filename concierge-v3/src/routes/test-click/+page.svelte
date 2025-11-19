<!--
  Click Test Page
  Purpose: Automated click testing to identify broken handlers
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let log = $state<string[]>([]);
	let isRunning = $state(false);

	function addLog(message: string) {
		log = [...log, `[${new Date().toLocaleTimeString()}] ${message}`];
		console.log(message);
	}

	async function testClicks() {
		isRunning = true;
		log = [];
		addLog('🚀 Starting automated click tests...');

		try {
			// Wait for page to be fully loaded
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Find all buttons
			const buttons = document.querySelectorAll('button');
			addLog(`📊 Found ${buttons.length} buttons on page`);

			// Test each button
			for (let i = 0; i < buttons.length; i++) {
				const button = buttons[i];
				const text = button.textContent?.trim() || button.getAttribute('aria-label') || `Button ${i+1}`;
				
				// Check if has handler
				const hasOnClick = button.onclick !== null;
				const hasAttribute = button.hasAttribute('onclick');
				const hasListener = button.outerHTML.includes('onclick');
				
				addLog(`\n🔘 Button: "${text}"`);
				addLog(`   - onclick property: ${hasOnClick ? '✅ Yes' : '❌ No'}`);
				addLog(`   - onclick attribute: ${hasAttribute ? '✅ Yes' : '❌ No'}`);
				addLog(`   - onclick in HTML: ${hasListener ? '✅ Yes' : '❌ No'}`);
				
				// Try to click
				try {
					let clicked = false;
					const originalOnClick = button.onclick;
					
					// Temporary wrapper to detect clicks
					button.onclick = (e) => {
						clicked = true;
						addLog(`   ✅ CLICK WORKED!`);
						if (originalOnClick) {
							originalOnClick.call(button, e);
						}
					};
					
					// Simulate click
					button.click();
					
					await new Promise(resolve => setTimeout(resolve, 100));
					
					if (!clicked) {
						addLog(`   ❌ CLICK DID NOT TRIGGER!`);
					}
					
					// Restore original
					button.onclick = originalOnClick;
				} catch (error: any) {
					addLog(`   ⚠️ Error clicking: ${error.message}`);
				}
			}

			addLog('\n✅ Test complete!');
		} catch (error: any) {
			addLog(`❌ Fatal error: ${error.message}`);
		} finally {
			isRunning = false;
		}
	}

	function clearLog() {
		log = [];
	}

	function copyLog() {
		navigator.clipboard.writeText(log.join('\n'));
		alert('Log copied to clipboard!');
	}
</script>

<div class="min-h-screen bg-neutral-50 p-6">
	<div class="max-w-4xl mx-auto">
		<div class="mb-6">
			<h1 class="text-3xl font-bold text-neutral-900 mb-2">🖱️ Click Test</h1>
			<p class="text-neutral-600">Automated button click testing</p>
		</div>

		<!-- Controls -->
		<div class="bg-white rounded-xl shadow-md p-6 mb-6">
			<div class="flex gap-3">
				<button
					onclick={testClicks}
					disabled={isRunning}
					class="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium disabled:opacity-50"
				>
					{isRunning ? '⏳ Testing...' : '▶️ Run Click Tests'}
				</button>
				<button
					onclick={clearLog}
					class="px-4 py-2 bg-neutral-600 text-white rounded-lg hover:bg-neutral-700 transition font-medium"
				>
					🗑️ Clear
				</button>
				<button
					onclick={copyLog}
					class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium"
				>
					📋 Copy
				</button>
			</div>
		</div>

		<!-- Log Output -->
		<div class="bg-white rounded-xl shadow-md p-6">
			<h2 class="text-xl font-bold text-neutral-900 mb-4">📜 Test Log</h2>
			<div class="bg-neutral-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-y-auto max-h-96">
				{#if log.length === 0}
					<p class="text-neutral-500">No tests run yet. Click "Run Click Tests" to start.</p>
				{:else}
					{#each log as entry}
						<div class="mb-1">{entry}</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Test Buttons -->
		<div class="mt-6 bg-white rounded-xl shadow-md p-6">
			<h2 class="text-xl font-bold text-neutral-900 mb-4">🎯 Test Buttons</h2>
			<p class="text-sm text-neutral-600 mb-4">These buttons are for testing the click detector:</p>
			<div class="space-y-2">
				<button
					onclick={() => addLog('✅ Test Button 1 clicked!')}
					class="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
				>
					Test Button 1 (with onclick)
				</button>
				<button
					class="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
				>
					Test Button 2 (NO onclick - broken!)
				</button>
				<button
					onclick={() => addLog('✅ Test Button 3 clicked!')}
					class="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
				>
					Test Button 3 (with onclick)
				</button>
			</div>
		</div>

		<!-- Navigation -->
		<div class="mt-6 bg-white rounded-xl shadow-md p-6">
			<h2 class="text-xl font-bold text-neutral-900 mb-4">🧭 Go to Page</h2>
			<div class="space-y-2">
				<button
					onclick={() => window.location.href = '/curations/new'}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					📝 New Curation (test RecordButton)
				</button>
				<button
					onclick={() => window.location.href = '/debug'}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					🔍 Debug Page
				</button>
				<button
					onclick={() => window.location.href = '/'}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					🏠 Dashboard
				</button>
			</div>
		</div>
	</div>
</div>
