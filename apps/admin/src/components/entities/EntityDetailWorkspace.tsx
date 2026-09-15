'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { getFieldValue, parseFieldPath, setFieldValue } from '../../content/field-path'
import { descriptorsFor } from '../../content/field-registry'
import { buildFieldTree, declaredButAbsent, flattenFieldTree } from '../../content/record-inspector'
import type { FieldNode } from '../../content/field-types'
import { humanizeFieldName } from '../../content/field-types'
import {
  isAdminRequestFailure,
  type LoadEntityRecord,
  type SaveEntityRecord,
} from '../../content/record-types'
import { ContentFieldEditor } from '../content/ContentFieldEditor'
import { ContentFieldInspector } from '../content/ContentFieldInspector'
import { AdminPage, AdminSection } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { StatusPill } from '../ui/StatusPill'
import { EntityCurationsSection, type EntityCurationsState } from './EntityCurationsSection'
import { EntityFieldSection } from './EntityFieldSection'
import { EntityImageThumbnail, type EntityImageState } from './EntityImageThumbnail'
import { browserEntityDetailClient, type LoadEntityImages } from './entity-detail-client'

const ENTITY_DESCRIPTORS = descriptorsFor('entity')

/** Which block owns the open editor — paths are unique per surface, not per page. */
type EntitySurface = 'canonical' | 'location' | 'contact' | 'media' | 'attributes' | 'metadata' | 'inspector'

type LoadPhase = 'loading' | 'ready' | 'notFound' | 'error'

/** Canonical fields: the Entity's own identity, edited through the registry editors. */
const CANONICAL_PATHS: Record<string, true> = {
  name: true,
  type: true,
  status: true,
  externalId: true,
}

/** Keys inside the flexible `data` blob that the LOCATION surface recognises. */
const LOCATION_KEYS: Record<string, true> = {
  city: true,
  address: true,
  location: true,
  locality: true,
  neighborhood: true,
  district: true,
  region: true,
  state: true,
  country: true,
  postalCode: true,
  postal_code: true,
  zip: true,
  zipCode: true,
  latitude: true,
  longitude: true,
  lat: true,
  lng: true,
  coordinates: true,
  geo: true,
  place_id: true,
  placeId: true,
  formattedAddress: true,
  formatted_address: true,
}

/** Keys inside `data` the CONTACT surface recognises. */
const CONTACT_KEYS: Record<string, true> = {
  contact: true,
  contacts: true,
  phone: true,
  phoneNumber: true,
  phone_number: true,
  telephone: true,
  email: true,
  website: true,
  url: true,
  social: true,
  instagram: true,
  facebook: true,
  whatsapp: true,
  reservation: true,
  reservations: true,
  menu: true,
  menu_url: true,
}

/** Keys inside `data` the MEDIA surface recognises. */
const MEDIA_KEYS: Record<string, true> = {
  media: true,
  photos: true,
  images: true,
  image: true,
  logo: true,
  gallery: true,
  video: true,
  videos: true,
  cover: true,
  coverImage: true,
  cover_image: true,
}

function humanError(error: unknown): string {
  if (isAdminRequestFailure(error)) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Entity not found.'
    if (error.status === 503) return 'The Entity service is unavailable.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function nodeAt(nodes: readonly FieldNode[], path: string): FieldNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
  }
  return null
}

/** A matched container plus its whole subtree: a section shows what it holds. */
function withDescendants(nodes: readonly FieldNode[]): FieldNode[] {
  const out: FieldNode[] = []
  for (const node of nodes) {
    out.push(node)
    out.push(...flattenFieldTree(node.children))
  }
  return out
}

/** The top-level fields of `nodes` whose name the table lists. */
function topLevelNodes(nodes: readonly FieldNode[], keys: Record<string, true>): FieldNode[] {
  const out: FieldNode[] = []
  for (const node of nodes) {
    if (keys[node.path] === true) out.push(node)
  }
  return out
}

/** Children of the `data` blob whose key the LOCATION/CONTACT/MEDIA table lists. */
function dataChildNodes(dataNode: FieldNode | null, keys: Record<string, true>): FieldNode[] {
  if (dataNode === null) return []
  const out: FieldNode[] = []
  for (const child of dataNode.children) {
    const leaf = parseFieldPath(child.path).at(-1)
    if (leaf !== undefined && leaf.kind === 'key' && keys[leaf.key] === true) out.push(child)
  }
  return withDescendants(out)
}

interface EntityDetailProps {
  entityId: string
  loadRecord?: LoadEntityRecord
  saveRecord?: SaveEntityRecord
  loadCurations?: (entityId: string) => Promise<{ items: Record<string, unknown>[]; total: number }>
  loadImages?: LoadEntityImages
  navigate?: (href: string) => void
}

/**
 * The Entity full-record page: §21 of the editorial CMS plan.
 *
 * The body is keyed by Entity id, so switching Entity starts from a clean
 * loading state instead of an effect that resets one.
 */
export function EntityDetailWorkspace(props: EntityDetailProps): ReactNode {
  return <EntityDetailBody key={props.entityId} {...props} />
}

/**
 * Every block is read-first and saves one top-level key at a time, so a PATCH
 * can never overwrite a field the editor was not looking at. Nothing here
 * invents a value: a section without stored fields says so.
 */
function EntityDetailBody({ entityId, loadRecord, saveRecord, loadCurations, loadImages, navigate }: EntityDetailProps): ReactNode {
  const load = loadRecord ?? browserEntityDetailClient.loadRecord
  const save = saveRecord ?? browserEntityDetailClient.saveRecord
  const loadEntityCurations = loadCurations ?? browserEntityDetailClient.loadCurations
  const loadEntityImage = loadImages ?? browserEntityDetailClient.loadImages

  const [reloadToken, setReloadToken] = useState(0)
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ surface: EntitySurface; path: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [search, setSearch] = useState('')
  const [image, setImage] = useState<EntityImageState>({ status: 'loading' })
  const [curations, setCurations] = useState<EntityCurationsState>({
    status: 'loading',
    items: [],
    total: 0,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    load(entityId).then(
      (result) => {
        if (cancelled) return
        setRecord(result.record)
        setPhase('ready')
      },
      (cause: unknown) => {
        if (cancelled) return
        if (isAdminRequestFailure(cause) && cause.status === 404) {
          setPhase('notFound')
          return
        }
        setLoadError(humanError(cause))
        setPhase('error')
      },
    )
    return () => {
      cancelled = true
    }
  }, [entityId, load, reloadToken])

  useEffect(() => {
    let cancelled = false
    loadEntityCurations(entityId).then(
      (page) => {
        if (cancelled) return
        setCurations({ status: 'ready', items: page.items, total: page.total, error: null })
      },
      (cause: unknown) => {
        if (cancelled) return
        setCurations({ status: 'error', items: [], total: 0, error: humanError(cause) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [entityId, loadEntityCurations])

  useEffect(() => {
    let cancelled = false
    loadEntityImage(entityId).then(
      (page) => {
        if (cancelled) return
        // The gallery is ascending by rank, so the first row is the hero (rank 0)
        // the rest of the Admin renders as the thumbnail.
        setImage({ status: 'ready', image: page.items[0] ?? null })
      },
      (cause: unknown) => {
        if (cancelled) return
        // No source configured is not a failure: the Entity simply has no image,
        // and the section says that instead of showing an error.
        if (isAdminRequestFailure(cause) && cause.status === 404) {
          setImage({ status: 'ready', image: null })
          return
        }
        setImage({ status: 'error', error: humanError(cause) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [entityId, loadEntityImage])

  /** Retry from the error surface: reset every read/edit state and read again. */
  function retryLoad() {
    setPhase('loading')
    setRecord(null)
    setLoadError(null)
    setEditing(null)
    setNotice(null)
    setSaveError(null)
    setConflict(false)
    setImage({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }

  const tree = useMemo(
    () => (record === null ? [] : buildFieldTree(record, ENTITY_DESCRIPTORS, 'entity')),
    [record],
  )
  const absent = useMemo(
    () => (record === null ? [] : declaredButAbsent(ENTITY_DESCRIPTORS, tree)),
    [record, tree],
  )

  function requestEdit(surface: EntitySurface, node: FieldNode) {
    setEditing({ surface, path: node.path })
    setNotice(null)
    setSaveError(null)
    setConflict(false)
  }

  function cancelEdit() {
    setEditing(null)
  }

  function editingPathFor(surface: EntitySurface): string | null {
    return editing !== null && editing.surface === surface ? editing.path : null
  }

  async function commitField(node: FieldNode, value: unknown) {
    if (record === null || saving) return
    const segments = parseFieldPath(node.path)
    const root = segments.length > 0 ? segments[0] : null
    if (root === null || root.kind !== 'key') return
    const rootKey = root.key
    let next: Record<string, unknown>
    try {
      next = setFieldValue(record, node.path, value)
    } catch (cause) {
      setNotice(null)
      setSaveError(cause instanceof Error ? cause.message : 'write_failed')
      return
    }
    const version = getFieldValue(record, 'version')
    setSaving(true)
    setNotice(null)
    setSaveError(null)
    setConflict(false)
    try {
      // One root key per PATCH, computed from the record the editor read, so a
      // concurrent change to any other field survives this save.
      const saved = await save({
        entityId,
        updates: { [rootKey]: getFieldValue(next, rootKey) },
        expectedVersion: typeof version === 'number' ? version : 0,
      })
      setRecord(saved.record)
      setEditing(null)
      setNotice(`Saved ${rootKey}.`)
    } catch (cause) {
      if (isAdminRequestFailure(cause) && cause.status === 409) {
        // The draft stays open and the stored value stays untouched.
        setConflict(true)
        return
      }
      setSaveError(humanError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function reloadAfterConflict() {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await load(entityId)
      setRecord(result.record)
      setEditing(null)
      setConflict(false)
      setNotice('Reloaded the latest Entity.')
    } catch (cause) {
      setSaveError(humanError(cause))
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'loading') {
    return (
      <AdminPage eyebrow="Entity" title="Entity">
        <p className="entity-detail__status" role="status">Loading Entity…</p>
      </AdminPage>
    )
  }

  if (phase === 'notFound') {
    return (
      <AdminPage eyebrow="Entity" title="Entity not found">
        <EmptyState
          title="Entity not found"
          description={`No stored Entity matches ${entityId}.`}
          action={
            <Link
              className="entity-detail__link"
              href="/admin/entities"
              onClick={(event) => {
                if (navigate === undefined) return
                event.preventDefault()
                navigate('/admin/entities')
              }}
            >
              Back to Entities
            </Link>
          }
        />
      </AdminPage>
    )
  }

  if (phase === 'error' || record === null) {
    return (
      <AdminPage eyebrow="Entity" title="Entity">
        <InlineNotice tone="error">
          {loadError ?? 'The Entity could not be loaded.'}
        </InlineNotice>
        <button
          className="entity-detail__retry"
          type="button"
          onClick={retryLoad}
        >
          Try again
        </button>
      </AdminPage>
    )
  }

  const name = getFieldValue(record, 'name')
  const type = getFieldValue(record, 'type')
  const status = getFieldValue(record, 'status')
  const entityIdentity = getFieldValue(record, 'entity_id')
  const city = getFieldValue(record, 'data.city')
  const externalId = getFieldValue(record, 'externalId')

  const dataNode = nodeAt(tree, 'data')
  const metadataNode = nodeAt(tree, 'metadata')
  const syncNode = nodeAt(tree, 'sync')
  const canonicalNodes = topLevelNodes(tree, CANONICAL_PATHS)
  const canonicalAbsent = absent.filter((descriptor) => CANONICAL_PATHS[descriptor.path] === true)
  const attributeContainers: FieldNode[] = []
  if (dataNode !== null) attributeContainers.push(dataNode)
  const metadataContainers: FieldNode[] = []
  if (metadataNode !== null) metadataContainers.push(metadataNode)
  if (syncNode !== null) metadataContainers.push(syncNode)
  const attributeNodes = withDescendants(attributeContainers)
  const metadataNodes = withDescendants(metadataContainers)
  const locationNodes = dataChildNodes(dataNode, LOCATION_KEYS)
  const contactNodes = dataChildNodes(dataNode, CONTACT_KEYS)
  const mediaNodes = dataChildNodes(dataNode, MEDIA_KEYS)
  const systemNodes = tree.filter((node) => node.system)

  return (
    <AdminPage
      eyebrow="Entity"
      title={typeof name === 'string' && name.trim().length > 0 ? name : 'Untitled entity'}
      description={typeof entityIdentity === 'string' ? entityIdentity : undefined}
      actions={typeof status === 'string' ? <StatusPill status={status} /> : undefined}
    >
      <section className="entity-detail__header" aria-label="Entity header">
        <dl className="entity-detail__facts">
          <div className="entity-detail__fact">
            <dt>Type</dt>
            <dd>{typeof type === 'string' ? humanizeFieldName(type) : 'Not set'}</dd>
          </div>
          <div className="entity-detail__fact">
            <dt>Status</dt>
            <dd>{typeof status === 'string' ? <StatusPill status={status} /> : 'Not set'}</dd>
          </div>
          <div className="entity-detail__fact">
            <dt>City</dt>
            <dd>{typeof city === 'string' && city.length > 0 ? city : 'Not set'}</dd>
          </div>
          <div className="entity-detail__fact">
            <dt>External id</dt>
            <dd>{typeof externalId === 'string' && externalId.length > 0 ? externalId : 'Not set'}</dd>
          </div>
        </dl>
      </section>

      {notice !== null && <InlineNotice tone="success">{notice}</InlineNotice>}
      {conflict && (
        <InlineNotice
          tone="warning"
          action={
            <button type="button" disabled={saving} onClick={() => void reloadAfterConflict()}>
              Reload
            </button>
          }
        >
          This Entity changed while you were editing it.
        </InlineNotice>
      )}
      {saveError !== null && <InlineNotice tone="error">{saveError}</InlineNotice>}
      {saving && <p className="entity-detail__status" role="status">Saving…</p>}

      <AdminSection
        title="Canonical identity"
        description="The Entity's own fields — the values other records project from."
      >
        <EntityFieldSection
          nodes={canonicalNodes}
          absent={canonicalAbsent}
          editingPath={editingPathFor('canonical')}
          onRequestEdit={(node) => requestEdit('canonical', node)}
          onCommitValue={(node, value) => void commitField(node, value)}
          onCancelEdit={cancelEdit}
        />
      </AdminSection>

      <AdminSection
        title="Location"
        description="Read from this Entity's data blob — this is where the Entity's location actually lives."
      >
        {locationNodes.length > 0
          ? (
              <EntityFieldSection
                nodes={locationNodes}
                editingPath={editingPathFor('location')}
                onRequestEdit={(node) => requestEdit('location', node)}
                onCommitValue={(node, value) => void commitField(node, value)}
                onCancelEdit={cancelEdit}
              />
            )
          : (
              <EmptyState
                title="No location stored"
                description="This Entity record stores no location fields."
              />
            )}
      </AdminSection>

      <AdminSection
        title="Contact"
        description="Read from this Entity's data blob: phone, email, website and the like."
      >
        {contactNodes.length > 0
          ? (
              <EntityFieldSection
                nodes={contactNodes}
                editingPath={editingPathFor('contact')}
                onRequestEdit={(node) => requestEdit('contact', node)}
                onCommitValue={(node, value) => void commitField(node, value)}
                onCancelEdit={cancelEdit}
              />
            )
          : (
              <EmptyState
                title="No contact stored"
                description="This Entity record stores no contact fields."
              />
            )}
      </AdminSection>

      <AdminSection
        title="Media"
        description="The image the domain resolves from this Entity's website or Place, plus the media its data blob stores."
      >
        <EntityImageThumbnail state={image} />
        {mediaNodes.length > 0
          ? (
              <EntityFieldSection
                nodes={mediaNodes}
                editingPath={editingPathFor('media')}
                onRequestEdit={(node) => requestEdit('media', node)}
                onCommitValue={(node, value) => void commitField(node, value)}
                onCancelEdit={cancelEdit}
              />
            )
          : (
              <EmptyState
                title="No media stored"
                description="This Entity record stores no images, logos or galleries."
              />
            )}
      </AdminSection>

      <AdminSection
        title="Attributes"
        description="The flexible data blob — the canonical source for values like city, address, website and phone."
      >
        {attributeNodes.length > 0
          ? (
              <EntityFieldSection
                nodes={attributeNodes}
                editingPath={editingPathFor('attributes')}
                onRequestEdit={(node) => requestEdit('attributes', node)}
                onCommitValue={(node, value) => void commitField(node, value)}
                onCancelEdit={cancelEdit}
              />
            )
          : (
              <EmptyState
                title="No attributes stored"
                description="This Entity record stores no flexible data."
              />
            )}
      </AdminSection>

      <AdminSection
        title="Curations about this Entity"
        description="Every stored Curation that points at this Entity."
      >
        <EntityCurationsSection state={curations} onNavigate={navigate} />
      </AdminSection>

      <AdminSection
        title="Metadata"
        description="Structured provenance: imported metadata sources and the client sync record."
      >
        {metadataNodes.length > 0
          ? (
              <EntityFieldSection
                nodes={metadataNodes}
                editingPath={editingPathFor('metadata')}
                onRequestEdit={(node) => requestEdit('metadata', node)}
                onCommitValue={(node, value) => void commitField(node, value)}
                onCancelEdit={cancelEdit}
              />
            )
          : (
              <EmptyState
                title="No metadata stored"
                description="This Entity record stores no metadata sources."
              />
            )}
      </AdminSection>

      <AdminSection
        title="All fields"
        description="Every stored field, registered or not, with record-local search."
      >
        <ContentFieldInspector
          record={record}
          kind="entity"
          descriptors={ENTITY_DESCRIPTORS}
          label="All stored fields"
          search={search}
          onSearchChange={setSearch}
          editingPath={editingPathFor('inspector')}
          onRequestEdit={(node) => requestEdit('inspector', node)}
          onCommitValue={(node, value) => void commitField(node, value)}
          onCancelEdit={cancelEdit}
          renderEditor={(node, commit, cancel) => (
            <ContentFieldEditor node={node} onCommit={commit} onCancel={cancel} />
          )}
        />
      </AdminSection>

      <AdminSection
        title="History"
        description="System-managed fields: visible, never editable from the Admin."
      >
        <EntityFieldSection nodes={systemNodes} editingPath={null} />
      </AdminSection>
    </AdminPage>
  )
}
