
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/curations" | "/curations/new" | "/curations/[id]" | "/curations/[id]/edit" | "/debug" | "/places" | "/settings" | "/test-click" | "/test-direct";
		RouteParams(): {
			"/curations/[id]": { id: string };
			"/curations/[id]/edit": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/curations": { id?: string };
			"/curations/new": Record<string, never>;
			"/curations/[id]": { id: string };
			"/curations/[id]/edit": { id: string };
			"/debug": Record<string, never>;
			"/places": Record<string, never>;
			"/settings": Record<string, never>;
			"/test-click": Record<string, never>;
			"/test-direct": Record<string, never>
		};
		Pathname(): "/" | "/curations" | "/curations/" | "/curations/new" | "/curations/new/" | `/curations/${string}` & {} | `/curations/${string}/` & {} | `/curations/${string}/edit` & {} | `/curations/${string}/edit/` & {} | "/debug" | "/debug/" | "/places" | "/places/" | "/settings" | "/settings/" | "/test-click" | "/test-click/" | "/test-direct" | "/test-direct/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): string & {};
	}
}