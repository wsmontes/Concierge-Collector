<!--
  Button Component
  Purpose: Reusable button with design system variants (primary, secondary, ghost)
  Dependencies: Tailwind CSS custom colors (teal, amber)
  
  Usage:
    <Button variant="primary" size="md" onclick={handleClick}>Click Me</Button>
    <Button variant="secondary" size="lg" disabled>Loading...</Button>
    <Button href="/path">Link Button</Button>
-->
<script lang="ts">
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		fullWidth?: boolean;
		loading?: boolean;
		onclick?: (event: MouseEvent) => void;
		href?: string;
	}

	let {
		variant = 'primary',
		size = 'md',
		fullWidth = false,
		loading = false,
		disabled = false,
		onclick,
		href,
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const baseClasses = 'btn font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

	const variantClasses = {
		primary: 'bg-teal-600 hover:bg-teal-700 text-white focus:ring-teal-500 shadow-md hover:shadow-lg',
		secondary: 'bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-400 shadow-md hover:shadow-lg',
		ghost: 'bg-transparent hover:bg-neutral-100 text-neutral-700 focus:ring-neutral-400',
		danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 shadow-md hover:shadow-lg'
	};

	const sizeClasses = {
		sm: 'px-3 py-1.5 text-sm min-h-[36px]',
		md: 'px-4 py-2 text-base min-h-[48px]',
		lg: 'px-6 py-3 text-lg min-h-[56px]'
	};

	const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`;
	
	// If href is provided, render as link; otherwise as button
	const isLink = !!href;
</script>

{#if isLink}
	<a 
		{href}
		class={`${classes} inline-flex items-center justify-center ${disabled ? 'pointer-events-none' : ''}`}
		aria-disabled={disabled || loading}
		{...rest}
	>
		{#if loading}
			<span class="inline-block animate-spin mr-2">⏳</span>
		{/if}
		{@render children?.()}
	</a>
{:else}
	<button 
		class={classes}
		disabled={disabled || loading}
		onclick={onclick}
		{...rest}
	>
		{#if loading}
			<span class="inline-block animate-spin mr-2">⏳</span>
		{/if}
		{@render children?.()}
	</button>
{/if}
