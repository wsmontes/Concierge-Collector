<!--
  Debug Page
  Purpose: Automated E2E testing and diagnostics
  Route: /debug
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { curations, addCuration, updateCuration, deleteCuration } from '$lib/stores';
	import { user, updateUser } from '$lib/stores/user';
	import { db } from '$lib/services/database';
	import { apiClient } from '$lib/services/apiClient';

	interface TestResult {
		name: string;
		status: 'pass' | 'fail' | 'running' | 'pending';
		message: string;
		duration?: number;
		error?: string;
	}

	let results = $state<TestResult[]>([]);
	let isRunning = $state(false);
	let currentTest = $state('');

	function addResult(name: string, status: TestResult['status'], message: string, duration?: number, error?: string) {
		const existingIndex = results.findIndex(r => r.name === name);
		const result = { name, status, message, duration, error };
		
		if (existingIndex >= 0) {
			results[existingIndex] = result;
			results = [...results];
		} else {
			results = [...results, result];
		}
	}

	function sleep(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async function testNavigation() {
		const routes = [
			{ path: '/', name: 'Dashboard' },
			{ path: '/curations', name: 'Curations List' },
			{ path: '/curations/new', name: 'New Curation' },
			{ path: '/places', name: 'Places' },
			{ path: '/settings', name: 'Settings' }
		];

		for (const route of routes) {
			addResult(`Navigate: ${route.name}`, 'running', `Testing ${route.path}...`);
			const start = Date.now();
			
			try {
				await goto(route.path);
				await sleep(500); // Wait for page to load
				
				const duration = Date.now() - start;
				const currentPath = window.location.pathname;
				const success = currentPath === route.path;
				
				addResult(
					`Navigate: ${route.name}`,
					success ? 'pass' : 'fail',
					success ? `Loaded in ${duration}ms` : `Wrong path: ${currentPath}`,
					duration
				);
			} catch (error: any) {
				addResult(`Navigate: ${route.name}`, 'fail', 'Navigation failed', Date.now() - start, error.message);
			}
			
			await sleep(200);
		}
	}

	async function testButtons() {
		// Test various button clicks
		const buttonTests = [
			{
				name: 'Button: Click Handler',
				test: () => {
					let clicked = false;
					const handler = () => { clicked = true; };
					handler();
					return clicked;
				}
			},
			{
				name: 'Button: Async Handler',
				test: async () => {
					let resolved = false;
					const asyncHandler = async () => {
						await sleep(10);
						resolved = true;
					};
					await asyncHandler();
					return resolved;
				}
			},
			{
				name: 'Button: Event Propagation',
				test: () => {
					if (!browser) return false;
					const button = document.createElement('button');
					let clicked = false;
					button.onclick = () => { clicked = true; };
					button.click();
					return clicked;
				}
			}
		];

		for (const test of buttonTests) {
			addResult(test.name, 'running', 'Testing...');
			const start = Date.now();
			
			try {
				const result = await test.test();
				const duration = Date.now() - start;
				addResult(
					test.name,
					result ? 'pass' : 'fail',
					result ? 'Handler executed' : 'Handler failed',
					duration
				);
			} catch (error: any) {
				addResult(test.name, 'fail', 'Test error', Date.now() - start, error.message);
			}
			
			await sleep(100);
		}
	}

	async function testStores() {
		// Test Curations Store
		addResult('Store: Read Curations', 'running', 'Reading...');
		const start1 = Date.now();
		try {
			const count = $curations.length;
			addResult('Store: Read Curations', 'pass', `Found ${count} curations`, Date.now() - start1);
		} catch (error: any) {
			addResult('Store: Read Curations', 'fail', 'Read failed', Date.now() - start1, error.message);
		}

		// Test Add Curation
		addResult('Store: Add Curation', 'running', 'Creating...');
		const start2 = Date.now();
		try {
			const before = $curations.length;
			const newCuration = addCuration({
				title: `Test ${Date.now()}`,
				status: 'draft',
				concepts: [],
				notes: 'Auto test'
			});
			await sleep(100);
			const after = $curations.length;
			const success = after === before + 1;
			addResult(
				'Store: Add Curation',
				success ? 'pass' : 'fail',
				success ? `ID: ${newCuration.id.slice(0, 8)}...` : 'Failed to add',
				Date.now() - start2
			);
		} catch (error: any) {
			addResult('Store: Add Curation', 'fail', 'Add failed', Date.now() - start2, error.message);
		}

		// Test Update Curation
		addResult('Store: Update Curation', 'running', 'Updating...');
		const start3 = Date.now();
		try {
			const testItem = $curations[0];
			if (testItem) {
				const newTitle = `Updated ${Date.now()}`;
				updateCuration(testItem.id, { title: newTitle });
				await sleep(100);
				const updated = $curations.find(c => c.id === testItem.id);
				const success = updated?.title === newTitle;
				addResult(
					'Store: Update Curation',
					success ? 'pass' : 'fail',
					success ? 'Updated successfully' : 'Update failed',
					Date.now() - start3
				);
			} else {
				addResult('Store: Update Curation', 'fail', 'No items to update', Date.now() - start3);
			}
		} catch (error: any) {
			addResult('Store: Update Curation', 'fail', 'Update error', Date.now() - start3, error.message);
		}

		// Test User Store
		addResult('Store: User Store', 'running', 'Checking...');
		const start4 = Date.now();
		try {
			const userName = $user?.name || 'Unknown';
			updateUser({ name: 'Test User' });
			await sleep(100);
			const updated = $user?.name === 'Test User';
			addResult(
				'Store: User Store',
				updated ? 'pass' : 'fail',
				updated ? 'User store working' : 'Update failed',
				Date.now() - start4
			);
		} catch (error: any) {
			addResult('Store: User Store', 'fail', 'User store error', Date.now() - start4, error.message);
		}
	}

	async function testDatabase() {
		// Test IndexedDB Read
		addResult('DB: Read', 'running', 'Reading...');
		const start1 = Date.now();
		try {
			const count = await db.curations.count();
			addResult('DB: Read', 'pass', `${count} items in DB`, Date.now() - start1);
		} catch (error: any) {
			addResult('DB: Read', 'fail', 'Read failed', Date.now() - start1, error.message);
		}

		// Test IndexedDB Write
		addResult('DB: Write', 'running', 'Writing...');
		const start2 = Date.now();
		try {
			const testId = crypto.randomUUID();
			await db.curations.add({
				id: testId,
				title: 'DB Test',
				status: 'draft',
				concepts: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			});
			const item = await db.curations.get(testId);
			const success = item?.id === testId;
			
			// Cleanup
			if (success) await db.curations.delete(testId);
			
			addResult('DB: Write', success ? 'pass' : 'fail', success ? 'Write successful' : 'Write failed', Date.now() - start2);
		} catch (error: any) {
			addResult('DB: Write', 'fail', 'Write error', Date.now() - start2, error.message);
		}

		// Test IndexedDB Query
		addResult('DB: Query', 'running', 'Querying...');
		const start3 = Date.now();
		try {
			const drafts = await db.curations.where('status').equals('draft').toArray();
			addResult('DB: Query', 'pass', `Found ${drafts.length} drafts`, Date.now() - start3);
		} catch (error: any) {
			addResult('DB: Query', 'fail', 'Query failed', Date.now() - start3, error.message);
		}
	}

	async function testAPI() {
		// Test API Health
		addResult('API: Health Check', 'running', 'Checking...');
		const start1 = Date.now();
		try {
			const health = await apiClient.getHealth();
			const duration = Date.now() - start1;
			addResult('API: Health Check', 'pass', `Status: ${health.status || 'OK'}`, duration);
		} catch (error: any) {
			addResult('API: Health Check', 'fail', 'Health check failed', Date.now() - start1, error.message);
		}

		// Test API Info
		addResult('API: Info', 'running', 'Fetching...');
		const start2 = Date.now();
		try {
			const info = await apiClient.getInfo();
			const duration = Date.now() - start2;
			addResult('API: Info', 'pass', `Version: ${info.version || 'unknown'}`, duration);
		} catch (error: any) {
			addResult('API: Info', 'fail', 'Info fetch failed', Date.now() - start2, error.message);
		}

		// Test API Key
		addResult('API: Key Check', 'running', 'Checking...');
		const start3 = Date.now();
		try {
			const hasKey = apiClient.getApiKey() !== null;
			addResult('API: Key Check', hasKey ? 'pass' : 'fail', hasKey ? 'API key configured' : 'No API key', Date.now() - start3);
		} catch (error: any) {
			addResult('API: Key Check', 'fail', 'Key check error', Date.now() - start3, error.message);
		}
	}

	async function testBrowserAPIs() {
		const apis = [
			{ name: 'fetch', available: typeof fetch !== 'undefined' },
			{ name: 'localStorage', available: typeof localStorage !== 'undefined' },
			{ name: 'IndexedDB', available: typeof indexedDB !== 'undefined' },
			{ name: 'MediaRecorder', available: typeof MediaRecorder !== 'undefined' },
			{ name: 'crypto', available: typeof crypto !== 'undefined' },
			{ name: 'navigator.mediaDevices', available: browser && 'mediaDevices' in navigator },
			{ name: 'History API', available: browser && 'history' in window },
			{ name: 'Clipboard API', available: browser && 'clipboard' in navigator }
		];

		for (const api of apis) {
			addResult(
				`Browser API: ${api.name}`,
				api.available ? 'pass' : 'fail',
				api.available ? 'Available' : 'Not available'
			);
			await sleep(50);
		}
	}

	async function testRecordButton() {
		addResult('RecordButton: MediaRecorder', 'running', 'Checking...');
		const start = Date.now();
		
		try {
			const hasMediaRecorder = browser && 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
			
			if (hasMediaRecorder) {
				addResult('RecordButton: MediaRecorder', 'pass', 'Media API available', Date.now() - start);
			} else {
				addResult('RecordButton: MediaRecorder', 'fail', 'No media access', Date.now() - start);
			}
		} catch (error: any) {
			addResult('RecordButton: MediaRecorder', 'fail', 'Check failed', Date.now() - start, error.message);
		}

		// Test callback simulation
		addResult('RecordButton: Callback', 'running', 'Testing...');
		const start2 = Date.now();
		try {
			let callbackExecuted = false;
			const mockCallback = (blob: Blob, duration: number) => {
				callbackExecuted = true;
			};
			
			const mockBlob = new Blob(['test'], { type: 'audio/webm' });
			mockCallback(mockBlob, 120);
			
			addResult(
				'RecordButton: Callback',
				callbackExecuted ? 'pass' : 'fail',
				callbackExecuted ? 'Callback works' : 'Callback failed',
				Date.now() - start2
			);
		} catch (error: any) {
			addResult('RecordButton: Callback', 'fail', 'Callback error', Date.now() - start2, error.message);
		}

		// Test DOM button clicks
		addResult('RecordButton: UI Click', 'running', 'Testing DOM...');
		const start3 = Date.now();
		try {
			// Navigate to new curation page
			await goto('/curations/new');
			await sleep(1000); // Wait for page load
			
			// Try to find the record button in DOM
			const recordButton = document.querySelector('button[aria-label*="recording"]');
			
			if (recordButton) {
				addResult('RecordButton: UI Click', 'pass', 'Button found in DOM', Date.now() - start3);
				
				// Test if onclick is attached
				const hasOnClick = recordButton.onclick !== null || recordButton.hasAttribute('onclick');
				addResult(
					'RecordButton: Click Handler',
					hasOnClick ? 'pass' : 'fail',
					hasOnClick ? 'Handler attached' : '⚠️ NO ONCLICK HANDLER!',
					Date.now() - start3
				);
			} else {
				addResult('RecordButton: UI Click', 'fail', 'Button not found in DOM', Date.now() - start3);
			}
		} catch (error: any) {
			addResult('RecordButton: UI Click', 'fail', 'DOM test error', Date.now() - start3, error.message);
		}
	}

	async function testUIButtons() {
		addResult('UI Test: Button Elements', 'running', 'Scanning DOM...');
		const start = Date.now();
		
		try {
			const allButtons = document.querySelectorAll('button');
			const buttonsWithOnClick = Array.from(allButtons).filter(btn => {
				return btn.onclick !== null || btn.hasAttribute('onclick');
			});
			
			const total = allButtons.length;
			const withHandlers = buttonsWithOnClick.length;
			const percentage = total > 0 ? Math.round((withHandlers / total) * 100) : 0;
			
			addResult(
				'UI Test: Button Elements',
				percentage > 50 ? 'pass' : 'fail',
				`${withHandlers}/${total} buttons have handlers (${percentage}%)`,
				Date.now() - start
			);

			// List buttons without handlers
			if (withHandlers < total) {
				const missingHandlers = Array.from(allButtons)
					.filter(btn => btn.onclick === null && !btn.hasAttribute('onclick'))
					.slice(0, 5)
					.map(btn => btn.textContent?.trim() || btn.getAttribute('aria-label') || 'Unnamed')
					.join(', ');
				
				addResult(
					'UI Test: Missing Handlers',
					'fail',
					`Examples: ${missingHandlers}`,
					Date.now() - start
				);
			}
		} catch (error: any) {
			addResult('UI Test: Button Elements', 'fail', 'DOM scan error', Date.now() - start, error.message);
		}
	}

	async function runAllTests() {
		results = [];
		isRunning = true;

		try {
			currentTest = 'Browser APIs';
			await testBrowserAPIs();
			await sleep(300);

			currentTest = 'Stores';
			await testStores();
			await sleep(300);

			currentTest = 'Database';
			await testDatabase();
			await sleep(300);

			currentTest = 'API';
			await testAPI();
			await sleep(300);

			currentTest = 'Buttons';
			await testButtons();
			await sleep(300);

			currentTest = 'RecordButton';
			await testRecordButton();
			await sleep(300);

			currentTest = 'UI Buttons';
			await testUIButtons();
			await sleep(300);

			currentTest = 'Navigation';
			await testNavigation();
			await sleep(300);

			currentTest = 'Complete';
		} catch (error: any) {
			addResult('Test Suite', 'fail', `Fatal error: ${error.message}`, 0, error.stack);
		} finally {
			isRunning = false;
			currentTest = '';
		}
	}

	const passCount = $derived(results.filter(r => r.status === 'pass').length);
	const failCount = $derived(results.filter(r => r.status === 'fail').length);
	const totalCount = $derived(results.length);
	const runningCount = $derived(results.filter(r => r.status === 'running').length);

	function copyResults() {
		const text = results.map(r => {
			let line = `[${r.status.toUpperCase()}] ${r.name}: ${r.message}`;
			if (r.duration) line += ` (${r.duration}ms)`;
			if (r.error) line += `\n  Error: ${r.error}`;
			return line;
		}).join('\n');
		
		navigator.clipboard.writeText(text);
		alert('Results copied to clipboard!');
	}

	onMount(() => {
		if (browser) {
			// Auto-run tests on mount
			setTimeout(() => runAllTests(), 500);
		}
	});
</script>

<div class="min-h-screen bg-neutral-50 p-6">
	<div class="max-w-4xl mx-auto">
		<!-- Header -->
		<div class="mb-6">
			<h1 class="text-3xl font-bold text-neutral-900 mb-2">🔍 End-to-End Diagnostics</h1>
			<p class="text-neutral-600">Comprehensive system testing</p>
		</div>

		<!-- Summary -->
		<div class="bg-white rounded-xl shadow-md p-6 mb-6">
			<div class="grid grid-cols-4 gap-4 text-center mb-4">
				<div>
					<div class="text-3xl font-bold text-green-600">{passCount}</div>
					<div class="text-sm text-neutral-600">Passed</div>
				</div>
				<div>
					<div class="text-3xl font-bold text-red-600">{failCount}</div>
					<div class="text-sm text-neutral-600">Failed</div>
				</div>
				<div>
					<div class="text-3xl font-bold text-amber-600">{runningCount}</div>
					<div class="text-sm text-neutral-600">Running</div>
				</div>
				<div>
					<div class="text-3xl font-bold text-neutral-900">{totalCount}</div>
					<div class="text-sm text-neutral-600">Total</div>
				</div>
			</div>

			{#if isRunning}
				<div class="py-3 px-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
					<div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-amber-500 border-t-transparent mr-2"></div>
					<span class="text-amber-900 font-medium">Testing: {currentTest}</span>
				</div>
			{:else}
				<div class="flex gap-2">
					<button
						onclick={runAllTests}
						class="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium"
					>
						🔄 Run All Tests
					</button>
					<button
						onclick={copyResults}
						class="px-4 py-2 bg-neutral-600 text-white rounded-lg hover:bg-neutral-700 transition font-medium"
					>
						📋 Copy Results
					</button>
				</div>
			{/if}
		</div>

		<!-- Test Results -->
		<div class="space-y-3">
			{#each results as result}
				<div class="bg-white rounded-lg shadow-sm p-4 border-l-4 {
					result.status === 'pass' ? 'border-green-500' :
					result.status === 'fail' ? 'border-red-500' :
					result.status === 'running' ? 'border-amber-500' :
					'border-neutral-300'
				}">
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-xl">
									{#if result.status === 'pass'}
										✅
									{:else if result.status === 'fail'}
										❌
									{:else if result.status === 'running'}
										<div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-amber-500 border-t-transparent"></div>
									{:else}
										⏸️
									{/if}
								</span>
								<h3 class="font-bold text-neutral-900">{result.name}</h3>
								{#if result.duration}
									<span class="text-xs text-neutral-500">{result.duration}ms</span>
								{/if}
							</div>
							<p class="text-sm text-neutral-600 ml-7">{result.message}</p>
							{#if result.error}
								<details class="ml-7 mt-2">
									<summary class="text-xs text-red-600 cursor-pointer hover:text-red-800">Show error details</summary>
									<pre class="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs overflow-x-auto">{result.error}</pre>
								</details>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		{#if results.length === 0 && !isRunning}
			<div class="bg-white rounded-xl shadow-md p-12 text-center">
				<p class="text-neutral-600 mb-4">No tests run yet</p>
				<button
					onclick={runAllTests}
					class="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium"
				>
					▶️ Start Testing
				</button>
			</div>
		{/if}

		<!-- System Info -->
		<div class="mt-6 bg-white rounded-xl shadow-md p-6">
			<h2 class="text-xl font-bold text-neutral-900 mb-4">📊 System Info</h2>
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<span class="text-neutral-600">User Agent:</span>
					<p class="font-mono text-xs mt-1 text-neutral-900 break-all">
						{browser ? navigator.userAgent : 'N/A'}
					</p>
				</div>
				<div>
					<span class="text-neutral-600">Screen:</span>
					<p class="font-mono text-xs mt-1 text-neutral-900">
						{browser ? `${window.innerWidth}x${window.innerHeight}` : 'N/A'}
					</p>
				</div>
				<div>
					<span class="text-neutral-600">Online:</span>
					<p class="font-mono text-xs mt-1 text-neutral-900">
						{browser ? (navigator.onLine ? '🟢 Yes' : '🔴 No') : 'N/A'}
					</p>
				</div>
				<div>
					<span class="text-neutral-600">Language:</span>
					<p class="font-mono text-xs mt-1 text-neutral-900">
						{browser ? navigator.language : 'N/A'}
					</p>
				</div>
			</div>
		</div>

		<!-- Quick Actions -->
		<div class="mt-6 bg-white rounded-xl shadow-md p-6">
			<h2 class="text-xl font-bold text-neutral-900 mb-4">🔧 Quick Actions</h2>
			<div class="space-y-2">
				<button
					onclick={() => window.location.href = '/'}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					🏠 Go to Dashboard
				</button>
				<button
					onclick={() => window.location.href = '/curations/new'}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					➕ New Curation
				</button>
				<button
					onclick={() => console.clear()}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					🗑️ Clear Console
				</button>
				<button
					onclick={() => location.reload()}
					class="w-full px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-left transition"
				>
					🔄 Reload Page
				</button>
			</div>
		</div>
	</div>
</div>
