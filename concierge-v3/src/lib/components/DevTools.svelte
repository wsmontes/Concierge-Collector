<!--
  DevTools Component
  Purpose: In-app development console for debugging without browser console
  
  Features:
    - Logs panel (info, error, warning)
    - Network requests monitoring
    - Store state inspector
    - Collapsible panel
    - Copy to clipboard
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { curations } from '$lib/stores/curations';
	import { user } from '$lib/stores/user';
	import { browser } from '$app/environment';

	interface LogEntry {
		id: string;
		timestamp: string;
		type: 'info' | 'error' | 'warning' | 'success' | 'network';
		message: string;
		data?: any;
	}

	let isOpen = $state(false);
	let logs = $state<LogEntry[]>([]);
	let activeTab = $state<'logs' | 'stores' | 'network'>('logs');

	// Functions
	function addLog(type: LogEntry['type'], message: string, data?: any) {
		const log: LogEntry = {
			id: `${Date.now()}-${Math.random()}`,
			timestamp: new Date().toLocaleTimeString(),
			type,
			message: String(message),
			data
		};
		logs = [log, ...logs].slice(0, 100);
	}

	function clearLogs() {
		logs = [];
	}

	function copyLogs() {
		if (!browser) return;
		const text = logs.map(l => `[${l.timestamp}] ${l.type.toUpperCase()}: ${l.message}`).join('\n');
		navigator.clipboard.writeText(text);
		addLog('success', 'Logs copied to clipboard!');
	}

	function togglePanel() {
		isOpen = !isOpen;
	}

	// Store inspection
	const storeState = $derived({
		curations: {
			total: $curations.length,
			published: $curations.filter(c => c.status === 'published').length,
			draft: $curations.filter(c => c.status === 'draft').length,
			items: $curations.slice(0, 5)
		},
		user: $user
	});

	// Only run interceptors in browser
	onMount(() => {
		if (!browser) return;

		// Intercept console methods
		const originalConsole = {
			log: console.log,
			error: console.error,
			warn: console.warn
		};

		console.log = (...args) => {
			addLog('info', args.join(' '), args);
			originalConsole.log(...args);
		};

		console.error = (...args) => {
			addLog('error', args.join(' '), args);
			originalConsole.error(...args);
		};

		console.warn = (...args) => {
			addLog('warning', args.join(' '), args);
			originalConsole.warn(...args);
		};

		// Intercept fetch
		const originalFetch = window.fetch;
		window.fetch = async (...args) => {
			const url = typeof args[0] === 'string' ? args[0] : args[0].url;
			const method = (args[1]?.method || 'GET').toUpperCase();
			
			addLog('network', `${method} ${url}`, { request: args[1] });
			
			try {
				const response = await originalFetch(...args);
				const status = response.status;
				const statusText = response.statusText;
				
				if (status >= 400) {
					addLog('error', `${method} ${url} → ${status} ${statusText}`);
				} else {
					addLog('success', `${method} ${url} → ${status} ${statusText}`);
				}
				
				return response;
			} catch (error: any) {
				addLog('error', `${method} ${url} → Network Error: ${error.message}`);
				throw error;
			}
		};
	});
</script>

<!-- Floating toggle button -->
<button
	onclick={togglePanel}
	class="fixed bottom-20 md:bottom-6 right-6 z-[60] w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 flex items-center justify-center transition-transform hover:scale-110"
	aria-label="Toggle DevTools"
>
	{#if isOpen}
		<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		</svg>
	{:else}
		<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
		</svg>
	{/if}
</button>

<!-- DevTools panel -->
{#if isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onclick={togglePanel}></div>
	<div class="fixed bottom-0 left-0 right-0 md:bottom-6 md:left-6 md:right-6 z-[51] bg-white rounded-t-3xl md:rounded-2xl shadow-2xl max-h-[70vh] flex flex-col">
		<!-- Header -->
		<div class="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
			<div class="flex items-center gap-2">
				<div class="w-3 h-3 rounded-full bg-purple-500"></div>
				<h3 class="font-bold text-neutral-900">DevTools</h3>
			</div>
			<div class="flex items-center gap-2">
				<button
					onclick={copyLogs}
					class="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition"
				>
					📋 Copy
				</button>
				<button
					onclick={clearLogs}
					class="px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 rounded-lg transition"
				>
					🗑️ Clear
				</button>
			</div>
		</div>

		<!-- Tabs -->
		<div class="flex border-b border-neutral-200 px-6">
			<button
				onclick={() => activeTab = 'logs'}
				class="px-4 py-3 text-sm font-medium border-b-2 transition {activeTab === 'logs' ? 'border-purple-500 text-purple-600' : 'border-transparent text-neutral-600 hover:text-neutral-900'}"
			>
				📜 Logs ({logs.length})
			</button>
			<button
				onclick={() => activeTab = 'stores'}
				class="px-4 py-3 text-sm font-medium border-b-2 transition {activeTab === 'stores' ? 'border-purple-500 text-purple-600' : 'border-transparent text-neutral-600 hover:text-neutral-900'}"
			>
				🗄️ Stores
			</button>
			<button
				onclick={() => activeTab = 'network'}
				class="px-4 py-3 text-sm font-medium border-b-2 transition {activeTab === 'network' ? 'border-purple-500 text-purple-600' : 'border-transparent text-neutral-600 hover:text-neutral-900'}"
			>
				🌐 Network
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-6">
			{#if activeTab === 'logs'}
				{#if logs.length === 0}
					<p class="text-center text-neutral-500 py-8">No logs yet</p>
				{:else}
					<div class="space-y-2">
						{#each logs as log (log.id)}
							<div class="p-3 rounded-lg border {
								log.type === 'error' ? 'bg-red-50 border-red-200' :
								log.type === 'warning' ? 'bg-amber-50 border-amber-200' :
								log.type === 'success' ? 'bg-green-50 border-green-200' :
								log.type === 'network' ? 'bg-blue-50 border-blue-200' :
								'bg-neutral-50 border-neutral-200'
							}">
								<div class="flex items-start justify-between gap-2">
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 mb-1">
											<span class="text-xs font-mono text-neutral-500">{log.timestamp}</span>
											<span class="text-xs font-bold uppercase {
												log.type === 'error' ? 'text-red-600' :
												log.type === 'warning' ? 'text-amber-600' :
												log.type === 'success' ? 'text-green-600' :
												log.type === 'network' ? 'text-blue-600' :
												'text-neutral-600'
											}">{log.type}</span>
										</div>
										<p class="text-sm text-neutral-900 break-words font-mono">{log.message}</p>
										{#if log.data && log.data.length > 1}
											<details class="mt-2">
												<summary class="text-xs text-neutral-500 cursor-pointer hover:text-neutral-700">View data</summary>
												<pre class="mt-2 text-xs bg-white p-2 rounded border border-neutral-200 overflow-x-auto">{JSON.stringify(log.data, null, 2)}</pre>
											</details>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if activeTab === 'stores'}
				<div class="space-y-4">
					<div class="p-4 rounded-lg bg-teal-50 border border-teal-200">
						<h4 class="font-bold text-teal-900 mb-2">Curations Store</h4>
						<div class="space-y-1 text-sm">
							<p><strong>Total:</strong> {storeState.curations.total}</p>
							<p><strong>Published:</strong> {storeState.curations.published}</p>
							<p><strong>Draft:</strong> {storeState.curations.draft}</p>
						</div>
						<details class="mt-3">
							<summary class="text-xs text-teal-700 cursor-pointer hover:text-teal-900">View items</summary>
							<pre class="mt-2 text-xs bg-white p-2 rounded border border-teal-200 overflow-x-auto">{JSON.stringify(storeState.curations.items, null, 2)}</pre>
						</details>
					</div>

					<div class="p-4 rounded-lg bg-amber-50 border border-amber-200">
						<h4 class="font-bold text-amber-900 mb-2">User Store</h4>
						<pre class="text-xs bg-white p-2 rounded border border-amber-200 overflow-x-auto">{JSON.stringify(storeState.user, null, 2)}</pre>
					</div>
				</div>
			{:else if activeTab === 'network'}
				<div class="space-y-2">
					{#each logs.filter(l => l.type === 'network' || (l.type === 'success' && l.message.includes('→')) || (l.type === 'error' && l.message.includes('→'))) as log (log.id)}
						<div class="p-3 rounded-lg border {
							log.type === 'error' ? 'bg-red-50 border-red-200' :
							'bg-green-50 border-green-200'
						}">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-xs font-mono text-neutral-500">{log.timestamp}</span>
							</div>
							<p class="text-sm font-mono">{log.message}</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	details summary {
		list-style: none;
	}
	details summary::-webkit-details-marker {
		display: none;
	}
</style>
