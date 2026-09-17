'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { CheckboxInput } from '../ui/Field'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { SkeletonRows } from '../ui/Skeleton'
import { SearchInput } from '../ui/Toolbar'

export interface DistributionCollectionOption {
  id: string
  slug: string
  title: string
  lifecycle: 'draft' | 'published' | 'archived'
  currentPublishedVersion: number | null
}

export type LoadDistributionCollections = () => Promise<DistributionCollectionOption[]>

/**
 * DÍVIDA REGISTRADA: este carregador exaure TODAS as páginas de Collections no
 * browser, em série, para montar a lista de concessão. Não existe endpoint de
 * busca/filtro de Collections no BFF do Admin (`/api/admin/v1/collections` é
 * cursor-only), então filtrar por título aqui exigiria um contrato novo — o que
 * a decisão D7 do plano proíbe. Com muitas Collections por página o custo é
 * N requisições por abertura de diálogo. Quando houver `?q=` no BFF, este
 * laço vira uma requisição.
 */
export async function browserLoadCollections(): Promise<DistributionCollectionOption[]> {
  const items: DistributionCollectionOption[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const response = await fetch(`/api/admin/v1/collections${query}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('unable_to_load_collections')
    const body = await response.json() as { items: DistributionCollectionOption[]; nextCursor?: string | null }
    items.push(...body.items)
    const next = body.nextCursor ?? null
    if (!next) break
    if (seen.has(next)) throw new Error('invalid_collection_pagination')
    seen.add(next)
    cursor = next
  } while (true)
  return items
}

function selectable(collection: DistributionCollectionOption, selected: boolean): boolean {
  // Existing access can always be removed even if the Collection has since
  // been archived. New grants require an actually published Collection.
  return selected || (collection.lifecycle === 'published' && collection.currentPublishedVersion !== null)
}

/**
 * Concessão de acesso por Collection. O contrato é o mesmo (`value`/`onChange`
 * com ids, `disabled`, `loadCollections` injetável); o que mudou é a superfície:
 * busca, estado de carregamento, falha com retry e vazio deixaram de ser texto
 * solto e passaram a ser os primitivos do kit.
 */
export function CollectionAccessPicker({
  value,
  onChange,
  disabled = false,
  loadCollections = browserLoadCollections,
}: {
  value: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  loadCollections?: LoadDistributionCollections
}) {
  const [collections, setCollections] = useState<DistributionCollectionOption[]>([])
  const [query, setQuery] = useState('')
  const [loadedKey, setLoadedKey] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const selected = useMemo(() => new Set(value), [value])
  // A tela de aplicações monta DOIS pickers ao mesmo tempo (o do formulário de
  // criação e o do diálogo de edição). Sem escopo por instância, os `id` de busca
  // e de cada checkbox se repetem no mesmo documento — `id` duplicado é HTML
  // inválido e quebra a associação rótulo/controle.
  const pickerId = useId()

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const loading = loadedKey !== reloadKey

  // O carregamento é DERIVADO do par (resultado, chave de recarga): enquanto o
  // resultado não é o da chave atual, está carregando. Sem isso o efeito teria de
  // ligar `loading` de forma síncrona no próprio corpo — o que dispara um render
  // em cascata e é o que a regra do compilador do React proíbe.
  useEffect(() => {
    let active = true
    void loadCollections().then(
      (items) => {
        if (!active) return
        setCollections(items)
        setError(null)
        setLoadedKey(reloadKey)
      },
      () => {
        if (!active) return
        setError('Unable to load Collections.')
        setLoadedKey(reloadKey)
      },
    )
    return () => { active = false }
  }, [loadCollections, reloadKey])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return collections
    return collections.filter((collection) => `${collection.title} ${collection.slug}`.toLocaleLowerCase().includes(normalized))
  }, [collections, query])

  function toggle(collection: DistributionCollectionOption, checked: boolean) {
    const isSelected = selected.has(collection.id)
    if (disabled || !selectable(collection, isSelected)) return
    const next = new Set(selected)
    if (checked) next.add(collection.id)
    else next.delete(collection.id)
    onChange([...next])
  }

  const selectedCount = value.length

  return (
    <section className="collection-access-picker" aria-label="Collection access">
      <SearchInput
        label="Find Collections"
        name={`collection-access-${pickerId}`}
        onChange={setQuery}
        placeholder="Search by title or slug"
        value={query}
      />

      {loading && <SkeletonRows rows={4} />}

      {!loading && error && (
        <ErrorState
          description="The Collection list did not load, so access cannot be changed right now."
          onRetry={reload}
          retryLabel="Try again"
          title="Collections could not load"
        />
      )}

      {!loading && !error && (
        <>
          <p className="collection-access-picker__count" role="status">
            {selectedCount === 0
              ? 'No Collection granted yet'
              : `${selectedCount.toLocaleString('en-US')} granted`}
          </p>
          {visible.length === 0 ? (
            <EmptyState
              description={query.trim().length > 0 ? 'Try another title or slug.' : undefined}
              title={query.trim().length > 0 ? 'No Collections match your search' : 'No Collections available'}
            />
          ) : (
            <div className="collection-access-picker__list">
              {visible.map((collection) => {
                const checked = selected.has(collection.id)
                const canSelect = selectable(collection, checked)
                return (
                  <CheckboxInput
                    checked={checked}
                    description={`${collection.slug} · ${collection.lifecycle}${collection.currentPublishedVersion ? ` · version ${collection.currentPublishedVersion}` : ' · not published'}${canSelect ? '' : ' · unavailable for new access'}`}
                    disabled={disabled || !canSelect}
                    id={`collection-access-${pickerId}-${collection.id}`}
                    key={collection.id}
                    label={collection.title}
                    onChange={(next) => toggle(collection, next)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}
