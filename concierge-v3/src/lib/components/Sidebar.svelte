<!--
  Sidebar Component
  Purpose: Desktop sidebar navigation (hidden on mobile, visible on md+)
  Dependencies: SvelteKit navigation, design system, user store
  
  Usage:
    <Sidebar />
  
  Features:
    - Logo + app title
    - Main navigation items
    - User section at bottom
    - Collapsible/expandable
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { user, userInitials } from '$lib/stores';

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
			label: 'My Curations',
			matchPath: (pathname: string) => pathname.startsWith('/curations')
		},
		{
			path: '/places',
			icon: '🔍',
			label: 'Find Places',
			matchPath: (pathname: string) => pathname.startsWith('/places')
		},
		{
			path: '/settings',
			icon: '⚙️',
			label: 'Settings',
			matchPath: (pathname: string) => pathname.startsWith('/settings')
		},
		{
			path: '/debug',
			icon: '🔍',
			label: 'Debug',
			matchPath: (pathname: string) => pathname.startsWith('/debug')
		}
	];

	function isActive(item: typeof navItems[0]) {
		return item.matchPath($page.url.pathname);
	}
</script>

<aside class="hidden md:flex md:flex-col fixed top-0 left-0 h-screen w-64 bg-white border-r border-neutral-200 z-40">
	<!-- Logo & Title -->
	<div class="flex items-center gap-3 px-6 py-6 border-b border-neutral-200">
		<div class="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-700 rounded-xl flex items-center justify-center text-white text-xl font-bold">
			C
		</div>
		<div>
			<h1 class="text-lg font-bold text-neutral-900">Concierge</h1>
			<p class="text-xs text-neutral-500">Collector V3</p>
		</div>
	</div>

	<!-- Navigation Items -->
	<nav class="flex-1 px-3 py-6 space-y-1">
		{#each navItems as item}
			<a
				href={item.path}
				class="flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
				class:bg-teal-50={isActive(item)}
				class:text-teal-700={isActive(item)}
				class:font-semibold={isActive(item)}
				class:text-neutral-700={!isActive(item)}
				class:hover:bg-neutral-100={!isActive(item)}
				aria-current={isActive(item) ? 'page' : undefined}
			>
				<span class="text-2xl">{item.icon}</span>
				<span>{item.label}</span>
			</a>
		{/each}
	</nav>

	<!-- User Section -->
	<div class="px-6 py-4 border-t border-neutral-200">
		<div class="flex items-center gap-3">
			<div class="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold">
				{$userInitials}
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-semibold text-neutral-900 truncate">
					{$user?.name || 'Guest User'}
				</p>
				<p class="text-xs text-neutral-500 truncate">Curator</p>
			</div>
		</div>
	</div>
</aside>
