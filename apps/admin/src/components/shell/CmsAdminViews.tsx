import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { CollectionsWorkspace } from '../collections/CollectionsWorkspace'
import { CollectionDetailWorkspace } from '../collections/CollectionDetailWorkspace'
import { CurationExplorer } from '../explorer/CurationExplorer'
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

export function ExplorerAdminView(props: AdminViewServerProps) {
  return (
    <AdminTemplate {...props}>
      <CurationExplorer targetCollectionId={singleParam(props.searchParams?.collection)} />
    </AdminTemplate>
  )
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
  const raw = props.params?.segments
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const id = segments[2]
  if (!id) notFound()
  return <CollectionDetailWorkspace collectionId={id} />
}
