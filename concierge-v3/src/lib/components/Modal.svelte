<!--
  Modal Component
  Purpose: Bottom sheet modal (mobile-first) that transitions to center modal on desktop
  Dependencies: Tailwind CSS, Svelte 5 transitions
  
  Usage:
    <Modal bind:open={showModal} title="Edit Restaurant">
      <p>Modal content...</p>
      <svelte:fragment slot="footer">
        <Button on:click={() => showModal = false}>Close</Button>
      </svelte:fragment>
    </Modal>
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';

	interface Props {
		open?: boolean;
		title?: string;
		size?: 'sm' | 'md' | 'lg' | 'full';
		onclose?: () => void;
		children?: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let {
		open = $bindable(false),
		title = '',
		size = 'md',
		onclose,
		children,
		footer
	}: Props = $props();

	const sizeClasses = {
		sm: 'max-w-md',
		md: 'max-w-2xl',
		lg: 'max-w-4xl',
		full: 'max-w-full mx-4'
	};

	function handleClose() {
		open = false;
		onclose?.();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="button"
		tabindex="0"
		aria-label="Close modal"
	></div>

	<!-- Modal -->
	<div
		class="fixed inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center z-50"
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
	>
		<div
			class="bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full {sizeClasses[size]} max-h-[90vh] md:max-h-[85vh] flex flex-col"
			transition:fly={{ y: 300, duration: 300 }}
		>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-neutral-200">
				{#if title}
					<h2 id="modal-title" class="text-2xl font-bold text-neutral-900">
						{title}
					</h2>
				{/if}
				<button
					type="button"
					class="ml-auto p-2 rounded-full hover:bg-neutral-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
					onclick={handleClose}
					aria-label="Close modal"
				>
					<svg class="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-6">
				{@render children?.()}
			</div>

			<!-- Footer -->
			{#if footer}
				<div class="border-t border-neutral-200 p-6 bg-neutral-50">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
