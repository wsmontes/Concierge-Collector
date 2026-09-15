/**
 * URL ⇄ list state for the Entities surface (plan §28: the URL is the state).
 *
 * Only `q`, `type`, `status` and `cursor` belong to the list. Every other key
 * of the query string is foreign — it is re-emitted untouched so a deep link
 * that carries, say, a campaign key still resolves after a filter change.
 */

export interface EntityListState {
  q: string
  type: string | null
  status: string | null
  cursor: string | null
}

const MANAGED_KEYS: Record<string, true | undefined> = {
  q: true,
  type: true,
  status: true,
  cursor: true,
}

function paramsOf(search: string | null | undefined): URLSearchParams {
  if (!search) return new URLSearchParams()
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

function trimmed(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/** Reads the list state; an absent key means "no filter", never an empty one. */
export function parseEntityListState(search: string | null | undefined): EntityListState {
  const params = paramsOf(search)
  return {
    q: params.get('q')?.trim() ?? '',
    type: trimmed(params.get('type')),
    status: trimmed(params.get('status')),
    cursor: trimmed(params.get('cursor')),
  }
}

/** Writes the state into a query string, unknown keys of `preserved` first. */
export function serializeEntityListState(state: EntityListState, preserved: string | null = null): string {
  const params = new URLSearchParams()
  for (const [key, value] of paramsOf(preserved)) {
    if (MANAGED_KEYS[key] !== true) params.append(key, value)
  }
  if (state.q) params.set('q', state.q)
  if (state.type) params.set('type', state.type)
  if (state.status) params.set('status', state.status)
  if (state.cursor) params.set('cursor', state.cursor)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Rewrites the address bar in place. The list never mounts a router: changing
 * a filter must not remount the surface nor clear the loaded page.
 */
export function writeEntityListState(state: EntityListState, preserved: string | null): void {
  const search = serializeEntityListState(state, preserved)
  window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
}
