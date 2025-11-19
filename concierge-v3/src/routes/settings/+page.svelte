<!--
  Settings Page
  Purpose: User settings and preferences
  Route: /settings
  
  Features:
    - User profile
    - API key configuration
    - App preferences
    - About/version info
-->
<script lang="ts">
	import { Header, Card, Input, Button, Badge } from '$lib/components';
	import { user, updateUser } from '$lib/stores';
	import { apiClient } from '$lib/services/apiClient';

	let userName = $state($user?.name || '');
	let userEmail = $state($user?.email || '');
	let apiKey = $state(apiClient.getApiKey() || '');
	let showApiKey = $state(false);

	function saveProfile() {
		updateUser({
			name: userName,
			email: userEmail
		});
		alert('Profile saved!');
	}

	function saveApiKey() {
		if (!apiKey.trim()) {
			alert('Please enter an API key');
			return;
		}
		
		apiClient.setApiKey(apiKey);
		updateUser({ apiKey });
		alert('API key saved! 🔑');
	}

	function toggleApiKeyVisibility() {
		showApiKey = !showApiKey;
	}
</script>

<Header title="Settings" />

<main class="container mx-auto px-4 py-6 max-w-4xl space-y-6">
	<!-- User Profile -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">Profile</h2>
		<div class="space-y-4">
			<Input
				label="Name"
				bind:value={userName}
			/>
			<Input
				label="Email"
				type="email"
				bind:value={userEmail}
			/>
			<Button onclick={saveProfile}>
				Save Profile
			</Button>
		</div>
	</Card>

	<!-- API Configuration -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">API Configuration</h2>
		<p class="text-sm text-neutral-600 mb-4">
			Required for AI features (transcription, concept extraction)
		</p>
		<div class="space-y-4">
			<div class="relative">
				<Input
					label="API Key"
					type={showApiKey ? 'text' : 'password'}
					bind:value={apiKey}
					helperText="Get your key from the API admin"
				/>
				<button
					onclick={toggleApiKeyVisibility}
					class="absolute right-3 top-10 text-neutral-500 hover:text-neutral-700"
					aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
				>
					{#if showApiKey}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
						</svg>
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
						</svg>
					{/if}
				</button>
			</div>
			<Button onclick={saveApiKey}>
				Save API Key
			</Button>
		</div>
	</Card>

	<!-- App Info -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-neutral-900">About</h2>
		<div class="space-y-3">
			<div class="flex justify-between items-center">
				<span class="text-sm text-neutral-600">Version</span>
				<Badge variant="neutral">3.0.0</Badge>
			</div>
			<div class="flex justify-between items-center">
				<span class="text-sm text-neutral-600">Build</span>
				<Badge variant="neutral">2025.11.18</Badge>
			</div>
			<div class="flex justify-between items-center">
				<span class="text-sm text-neutral-600">Framework</span>
				<Badge variant="primary">SvelteKit 2</Badge>
			</div>
		</div>
	</Card>

	<!-- Danger Zone -->
	<Card>
		<h2 class="text-xl font-bold mb-4 text-red-700">Danger Zone</h2>
		<div class="space-y-3">
			<Button variant="danger" fullWidth onclick={() => confirm('Clear all local data?')}>
				Clear Local Data
			</Button>
			<Button variant="danger" fullWidth onclick={() => confirm('Delete account?')}>
				Delete Account
			</Button>
		</div>
	</Card>
</main>
