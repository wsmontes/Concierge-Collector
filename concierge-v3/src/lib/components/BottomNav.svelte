<!--
  BottomNav Component
  Purpose: Mobile-first bottom navigation (iOS/Android pattern)
  Dependencies: SvelteKit navigation, design system colors
  
  Usage:
    <BottomNav />
  
  Features:
    - 4 primary actions (Dashboard, Curations, Places, Settings)
    - Active state with teal accent
    - 48px touch targets
    - Icons + labels for clarity
-->
<script lang="ts">
	import { page } from '$app/stores';

	const navItems = [
		{
			path: '/',
			icon: '🏠',
			label: 'Dashboard',
			matchPath: (pathname: string) => pathname === '/'
		},
		{
			path: '/curations',
			icon: '🎙️',
			label: 'Curations',
			matchPath: (pathname: string) => pathname.startsWith('/curations')
		},
		{
			path: '/places',
			icon: '🔍',
			label: 'Places',
			matchPath: (pathname: string) => pathname.startsWith('/places')
		},
		{
			path: '/settings',
			icon: '⚙️',
			label: 'Settings',
			matchPath: (pathname: string) => pathname.startsWith('/settings')
		}
	];

	function isActive(item: typeof navItems[0]) {
		return item.matchPath($page.url.pathname);
	}
</script>

<nav class="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-neutral-200 md:hidden">
	<div class="flex justify-around items-center h-16">
		{#each navItems as item}
			<a
				href={item.path}
				class="flex flex-col items-center justify-center flex-1 min-h-[48px] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500"
				class:text-teal-600={isActive(item)}
				class:font-semibold={isActive(item)}
				class:text-neutral-600={!isActive(item)}
				aria-current={isActive(item) ? 'page' : undefined}
			>
				<span class="text-2xl mb-1">{item.icon}</span>
				<span class="text-xs">{item.label}</span>
			</a>
		{/each}
	</div>
</nav>
