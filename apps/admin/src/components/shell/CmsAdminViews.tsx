import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { CollectionsWorkspace } from '../collections/CollectionsWorkspace'
import { CollectionDetailWorkspace } from '../collections/CollectionDetailWorkspace'
import { OperationsWorkspace } from '../operations/OperationsWorkspace'
import { ApplicationViews } from '../applications/ApplicationViews'
import { CurationsWorkspace } from '../curations/CurationsWorkspace'
import { CurationRecordWorkspace } from '../curations/CurationRecordWorkspace'
import { EntityRecordWorkspace } from '../curations/EntityRecordWorkspace'

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
 * `/admin/explorer` is the old name of `/admin/curations`. It stays as a
 * permanent redirect so existing bookmarks and Collection links keep working;
 * the query string (including `?collection=`) is carried over.
 */
export function ExplorerAdminView(props: AdminViewServerProps) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(props.searchParams ?? {})) {
    if (typeof value === 'string' && value.length > 0) query.set(key, value)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  redirect(`/admin/curations${suffix}`)
}

export function CurationsAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <CurationsWorkspace targetCollectionId={singleParam(props.searchParams?.collection)} />
    </AdminTemplate>
  )
}

/**
 * `/admin/curations/<id>` — the canonical Curation record.
 *
 * The id arrives in `params.segments` (the catch-all), not in `docID`:
 * `routeParams.id` is only filled by the native document branch of
 * `getRouteData`, which custom views never reach. Next hands the segments over
 * already decoded, so the id must not be decoded again.
 */
export function CurationRecordAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <CurationRecordWorkspace curationId={segment(props, 1)} />
    </AdminTemplate>
  )
}

/** `/admin/entities/<id>` — the canonical Entity record, linked from a Curation's About section. */
export function EntityRecordAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <EntityRecordWorkspace entityId={segment(props, 1)} />
    </AdminTemplate>
  )
}

/**
 * Reads one segment out of the catch-all route params. The fallback keeps a
 * malformed URL from rendering a record screen for an empty id.
 */
function segment(props: AdminViewServerProps, index: number): string {
  const raw = props.params?.segments
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const value = segments[index]
  if (!value) notFound()
  return value
}

export function OperationsAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <OperationsWorkspace />
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
  return <CollectionDetailWorkspace collectionId={segment(props, 2)} />
}
