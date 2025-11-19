<!--
  Input Component
  Purpose: Form input with validation states and design system styling
  Dependencies: Tailwind CSS, Inter font
  
  Usage:
    <Input bind:value={name} label="Name" placeholder="Enter your name" />
    <Input bind:value={email} type="email" error="Invalid email" />
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		label?: string;
		error?: string;
		helperText?: string;
		fullWidth?: boolean;
	}

	let {
		label = '',
		error = '',
		helperText = '',
		fullWidth = true,
		type = 'text',
		disabled = false,
		class: className = '',
		value = $bindable(''),
		...rest
	}: Props = $props();

	const baseClasses = 'px-4 py-3 rounded-lg border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]';

	const stateClasses = error 
		? 'border-red-500 focus:ring-red-500 focus:border-red-500'
		: 'border-neutral-300 focus:ring-teal-500 focus:border-teal-500';

	const classes = `${baseClasses} ${stateClasses} ${fullWidth ? 'w-full' : ''} ${className}`;
</script>

<div class={fullWidth ? 'w-full' : ''}>
	{#if label}
		<label class="block text-sm font-medium text-neutral-700 mb-2">
			{label}
		</label>
	{/if}
	
	<input
		class={classes}
		{type}
		{disabled}
		bind:value
		{...rest}
	/>

	{#if error}
		<p class="mt-1 text-sm text-red-600">
			{error}
		</p>
	{:else if helperText}
		<p class="mt-1 text-sm text-neutral-500">
			{helperText}
		</p>
	{/if}
</div>
