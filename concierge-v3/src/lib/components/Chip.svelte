<!--
  Chip Component
  Purpose: Removable tag/label component for concepts, categories, filters
  Dependencies: Tailwind CSS
  
  Usage:
    <Chip on:remove={() => console.log('removed')}>Ambiance</Chip>
    <Chip variant="secondary" removable={false}>Featured</Chip>
-->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: 'primary' | 'secondary' | 'neutral';
		removable?: boolean;
		onremove?: () => void;
	}

	let {
		variant = 'primary',
		removable = true,
		onremove,
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const baseClasses = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200';

	const variantClasses = {
		primary: 'bg-teal-100 text-teal-800 hover:bg-teal-200',
		secondary: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
		neutral: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
	};

	const classes = `${baseClasses} ${variantClasses[variant]} ${className}`;

</script>

<div class={classes} {...rest}>
	<span>
		{@render children?.()}
	</span>
	
	{#if removable}
		<button
			type="button"
			class="flex-shrink-0 ml-1 rounded-full p-0.5 hover:bg-black/10 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current"
			onclick={onremove}
			aria-label="Remove"
		>
			<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
				<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
			</svg>
		</button>
	{/if}
</div>
