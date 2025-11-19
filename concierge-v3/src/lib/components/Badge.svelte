<!--
  Badge Component
  Purpose: Status indicator with color variants
  Dependencies: Tailwind CSS custom colors
  
  Usage:
    <Badge variant="success">Published</Badge>
    <Badge variant="warning">Draft</Badge>
    <Badge variant="info" size="lg">Featured</Badge>
-->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLSpanElement> {
		variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
		size?: 'sm' | 'md' | 'lg';
		rounded?: boolean;
	}

	let {
		variant = 'primary',
		size = 'md',
		rounded = false,
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const baseClasses = 'inline-flex items-center font-medium transition-colors duration-200';

	const variantClasses = {
		primary: 'bg-teal-100 text-teal-800 border border-teal-200',
		secondary: 'bg-amber-100 text-amber-800 border border-amber-200',
		success: 'bg-green-100 text-green-800 border border-green-200',
		warning: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
		danger: 'bg-red-100 text-red-800 border border-red-200',
		info: 'bg-blue-100 text-blue-800 border border-blue-200',
		neutral: 'bg-neutral-100 text-neutral-800 border border-neutral-200'
	};

	const sizeClasses = {
		sm: 'px-2 py-0.5 text-xs',
		md: 'px-2.5 py-1 text-sm',
		lg: 'px-3 py-1.5 text-base'
	};

	const roundedClass = rounded ? 'rounded-full' : 'rounded-md';

	const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${roundedClass} ${className}`;
</script>

<span class={classes} {...rest}>
	{@render children?.()}
</span>
