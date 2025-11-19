<!--
  Card Component
  Purpose: Container component for content grouping with elevation
  Dependencies: Tailwind CSS shadows
  
  Usage:
    <Card>
      <h2>Card Title</h2>
      <p>Card content...</p>
    </Card>
    <Card padding="lg" hoverable clickable on:click={handleClick}>
-->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		padding?: 'none' | 'sm' | 'md' | 'lg';
		hoverable?: boolean;
		clickable?: boolean;
		elevated?: boolean;
	}

	let {
		padding = 'md',
		hoverable = false,
		clickable = false,
		elevated = false,
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const baseClasses = 'bg-white rounded-xl border border-neutral-200 transition-all duration-200';

	const paddingClasses = {
		none: '',
		sm: 'p-4',
		md: 'p-6',
		lg: 'p-8'
	};

	const shadowClasses = elevated ? 'shadow-lg' : 'shadow-md';
	const hoverClasses = hoverable ? 'hover:shadow-xl hover:-translate-y-1' : '';
	const clickClasses = clickable ? 'cursor-pointer active:scale-98' : '';

	const classes = `${baseClasses} ${paddingClasses[padding]} ${shadowClasses} ${hoverClasses} ${clickClasses} ${className}`;
</script>

<div 
	class={classes}
	role={clickable ? 'button' : undefined}
	tabindex={clickable ? 0 : undefined}
	{...rest}
>
	{@render children?.()}
</div>
