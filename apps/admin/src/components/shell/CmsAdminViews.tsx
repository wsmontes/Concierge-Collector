import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { CollectionsWorkspace } from '../collections/CollectionsWorkspace'
import { CollectionDetailWorkspace } from '../collections/CollectionDetailWorkspace'
import { CurationsWorkspace } from '../curations/CurationsWorkspace'
import { CurationDetailWorkspace } from '../curations/CurationDetailWorkspace'
import { EntitiesWorkspace } from '../entities/EntitiesWorkspace'
import { EntityDetailWorkspace } from '../entities/EntityDetailWorkspace'
import { OperationsWorkspace } from '../operations/OperationsWorkspace'
import { ApplicationViews } from '../applications/ApplicationViews'

const ADMIN_LOGIN = '/admin/login'

/**
 * Root Custom Views são PÚBLICAS por padrão: o Payload pula o próprio redirect de
 * auth para elas (isCustomAdminView em @payloadcms/next/dist/utilities/isCustomAdminView.js).
 * Este wrapper é a guarda dessas três telas.
 *
 * Props conforme a doc oficial (Customizing Views → View Templates → Default Props).
 */
function AdminTemplate({ children, ...props }: AdminViewServerProps & { children: ReactNode }) {
  const { initPageResult } = props
  if (!initPageResult.req.user) redirect(ADMIN_LOGIN)

  return (
    <DefaultTemplate
      i18n={props.i18n}
      locale={initPageResult.locale}
      params={props.params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={props.searchParams}
      user={initPageResult.req.user}
      visibleEntities={initPageResult.visibleEntities}
    >
      {children}
    </DefaultTemplate>
  )
}

function singleParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Root Custom Views recebem `searchParams` já resolvidos pelo catch-all; as
 * telas editoriais querem o query string. Chaves repetidas viram parâmetros
 * repetidos, porque `status=a&status=b` é um estado válido da lista.
 */
function queryString(searchParams: AdminViewServerProps['searchParams']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else if (typeof value === 'string') params.set(key, value)
  }
  return params.toString()
}

/**
 * `/admin/explorer` virou compatibilidade: o Explorer é agora a tela `Curations`.
 * A view continua registrada para que deep links antigos (`/admin/explorer?collection=…`)
 * não morram, e mantém a guarda de auth — Root Custom Views são públicas por padrão.
 */
export function ExplorerAdminView(props: AdminViewServerProps) {
  if (!props.initPageResult.req.user) redirect(ADMIN_LOGIN)
  const collection = singleParam(props.searchParams?.collection)
  redirect(collection ? `/admin/curations?collection=${encodeURIComponent(collection)}` : '/admin/curations')
}

export function OperationsAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <OperationsWorkspace />
    </AdminTemplate>
  )
}

/** `/admin/curations` — a lista editorial. O query string é o estado da tela. */
export function CurationsAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <CurationsWorkspace
        initialQuery={queryString(props.searchParams)}
        targetCollectionId={singleParam(props.searchParams?.collection)}
      />
    </AdminTemplate>
  )
}

/**
 * `/admin/curations/<id>`. Como toda Root Custom View, o id não vem em `docID`:
 * o catch-all entrega `params.segments = ['curations', '<id>']`, já decodificado.
 */
export function CurationDetailAdminView(props: AdminViewServerProps) {
  const raw = props.params?.segments
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const id = segments[1]
  if (!id) notFound()
  return (
    <AdminTemplate {...props}>
      <CurationDetailWorkspace curationId={id} />
    </AdminTemplate>
  )
}

/** `/admin/entities` — a lista editorial de Entities. */
export function EntitiesAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <EntitiesWorkspace initialQuery={queryString(props.searchParams)} />
    </AdminTemplate>
  )
}

/**
 * `/admin/entities/<id>`. Como toda Root Custom View, o id não vem em `docID`:
 * o catch-all entrega `params.segments = ['entities', '<id>']`.
 */
export function EntityDetailAdminView(props: AdminViewServerProps) {
  const raw = props.params?.segments
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const id = segments[1]
  if (!id) notFound()
  return (
    <AdminTemplate {...props}>
      <EntityDetailWorkspace entityId={id} />
    </AdminTemplate>
  )
}

export function ApplicationsAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <ApplicationViews />
    </AdminTemplate>
  )
}

/**
 * Override da LIST VIEW do collection `collections`. O Payload renderiza dentro do
 * ListView com template e auth padrão (getRouteData → templateType='default'), então
 * esta não precisa de wrapper.
 */
export function CollectionsAdminView() {
  return <CollectionsWorkspace />
}

/**
 * View de collection no path `/:id`. Também recebe template e auth do Payload.
 * O id NÃO vem em `docID`: `routeParams.id` só é preenchido no ramo da edit view
 * nativa (getRouteData termina sem setá-lo no ramo de custom view). Vem do catch-all:
 * `/admin/collections/collections/<id>` → params.segments = ['collections','collections','<id>'].
 * Segmentos do Next já vêm decodificados — não chamar decodeURIComponent.
 */
export function CollectionDetailAdminView(props: AdminViewServerProps) {
  const raw = props.params?.segments
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const id = segments[2]
  if (!id) notFound()
  return <CollectionDetailWorkspace collectionId={id} />
}
