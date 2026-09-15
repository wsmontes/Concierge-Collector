'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getFieldValue, parseFieldPath, setFieldValue } from '../../content/field-path'
import { descriptorsFor } from '../../content/field-registry'
import {
  isFieldEditable,
  isStructuredType,
  type FieldDescriptor,
  type FieldNode,
} from '../../content/field-types'
import { buildFieldTree, flattenFieldTree } from '../../content/record-inspector'
import {
  isAdminRequestFailure,
  type CurationCollectionLink,
  type CurationRecordResponse,
  type LoadCurationRecord,
  type SaveCurationRecord,
} from '../../content/record-types'
import { AdminPage } from '../ui/AdminPage'
import { EmptyState } from '../ui/EmptyState'
import { InlineNotice } from '../ui/InlineNotice'
import { CurationAboutSection } from './CurationAboutSection'
import { CurationAdvancedSection } from './CurationAdvancedSection'
import { CurationAllFieldsSection } from './CurationAllFieldsSection'
import { CurationCollectionsSection } from './CurationCollectionsSection'
import { CurationConceptsSection } from './CurationConceptsSection'
import { CurationEditorialSection } from './CurationEditorialSection'
import { CurationHistorySection } from './CurationHistorySection'
import { CurationLink, navigateInBrowser, type CurationNavigate } from './CurationLink'
import { CurationMediaSection } from './CurationMediaSection'
import { CurationRecordHeader } from './CurationRecordHeader'
import { loadCurationRecordFromBff, saveCurationRecordToBff } from './curation-record-client'
import type { CurationSectionEditProps } from './CurationFieldBlock'
import {
  asString,
  conceptGroups,
  curatorContext,
  entityContext,
  readableText,
  recordVersion,
  sourceBuckets,
} from './curation-record-values'

/** The Curation list this page belongs to. */
const LIST_HREF = '/admin/curations'
/** The registry's name for the editorial block of a Curation (plan §15). */
const EDITORIAL_SECTION = 'Your curation'

/** A save the server refused because the record moved on (plan §33). */
interface CurationConflict {
  label: string
  draft: unknown
  stored: unknown
}

/**
 * A declared field the record does not carry still needs an editable node: the
 * field tree only emits stored keys, and "an empty legacy field gains a value"
 * (plan §31) is exactly this case. The editability rule mirrors the tree's —
 * system always wins, and a known field opts out with `editable: false`.
 */
function placeholderNode(descriptor: FieldDescriptor): FieldNode {
  const system = descriptor.system === true
  return {
    path: descriptor.path,
    label: descriptor.label,
    type: descriptor.type,
    value: undefined,
    depth: descriptor.path.split('.').length - 1,
    descriptor,
    owner: descriptor.owner,
    editable: !system && descriptor.editable !== false && isFieldEditable(descriptor.type),
    system,
    children: [],
  }
}

/** The top-level key a PATCH touches — the only unit this page ever sends. */
function rootKeyOf(path: string): string | null {
  const first = parseFieldPath(path)[0]
  if (first === undefined || first.kind !== 'key') return null
  return first.key
}

function failureMessage(error: unknown): string {
  if (isAdminRequestFailure(error)) {
    if (error.status === 401) return 'Your Admin session has expired.'
    if (error.status === 403) return 'Admin access is required.'
    if (error.status === 404) return 'Curation not found.'
    if (error.status === 503) return 'The Curations service is unavailable.'
    return error.code
  }
  return error instanceof Error ? error.message : 'request_failed'
}

function LoadingSurface(): ReactNode {
  return (
    <AdminPage eyebrow="Curations" title="Curation" description="Loading this record.">
      <p role="status">Loading Curation…</p>
    </AdminPage>
  )
}

function NotFoundSurface({ curationId, navigate }: { curationId: string; navigate: CurationNavigate }): ReactNode {
  return (
    <AdminPage
      eyebrow="Curations"
      title="Curation not found"
      description={`No Curation is stored for ${curationId}.`}
      actions={<CurationLink href={LIST_HREF} navigate={navigate}>← All Curations</CurationLink>}
    >
      <EmptyState
        title="Nothing to show"
        description="This Curation may have been deleted, or the link may be wrong. Nothing was changed."
      />
    </AdminPage>
  )
}

function ErrorSurface({
  message,
  onRetry,
  navigate,
}: {
  message: string
  onRetry: () => void
  navigate: CurationNavigate
}): ReactNode {
  return (
    <AdminPage
      eyebrow="Curations"
      title="Curation unavailable"
      actions={<CurationLink href={LIST_HREF} navigate={navigate}>← All Curations</CurationLink>}
    >
      <InlineNotice tone="error" action={<button type="button" onClick={onRetry}>Try again</button>}>
        {message}
      </InlineNotice>
    </AdminPage>
  )
}

/**
 * The Curation full record page (plan §13–§19, §26, §32–§34, §46).
 *
 * The record and the open editor live here, and every surface below saves
 * through the same path: apply the edit to the record immutably, then PATCH
 * exactly the top-level key the edit touched, with the version the page opened.
 * A 409 keeps the draft and the stored value apart instead of overwriting one
 * with the other.
 */
export function CurationDetailWorkspace({
  curationId,
  loadRecord = loadCurationRecordFromBff,
  saveRecord = saveCurationRecordToBff,
  navigate = navigateInBrowser,
}: {
  curationId: string
  loadRecord?: LoadCurationRecord
  saveRecord?: SaveCurationRecord
  navigate?: (href: string) => void
}): ReactNode {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [collections, setCollections] = useState<readonly CurationCollectionLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [inspectorPath, setInspectorPath] = useState<string | null>(null)
  const [savingPath, setSavingPath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<CurationConflict | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  /**
   * The effect starts the read and applies the outcome from its callbacks: an
   * effect body must not set state on its own turn, and a cancelled request is
   * dropped rather than written over a newer one.
   */
  const applyLoaded = useCallback((loaded: CurationRecordResponse) => {
    setRecord(loaded.record)
    setCollections(loaded.collections)
    setNotFound(false)
    setEditingPath(null)
    setInspectorPath(null)
    setConflict(null)
    setSaveError(null)
    setLoading(false)
  }, [])

  const applyFailure = useCallback((cause: unknown) => {
    if (isAdminRequestFailure(cause) && cause.status === 404) setNotFound(true)
    else setLoadError(failureMessage(cause))
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadRecord(curationId).then(
      (loaded) => {
        if (!cancelled) applyLoaded(loaded)
      },
      (cause: unknown) => {
        if (!cancelled) applyFailure(cause)
      },
    )
    return () => {
      cancelled = true
    }
  }, [applyFailure, applyLoaded, curationId, loadRecord])

  /** The same read again, this time because a reader asked for it. */
  async function reload() {
    setLoading(true)
    setNotFound(false)
    setLoadError(null)
    try {
      applyLoaded(await loadRecord(curationId))
    } catch (cause) {
      applyFailure(cause)
    }
  }

  const descriptors = useMemo(() => descriptorsFor('curation'), [])
  const tree = useMemo(
    () => (record === null ? [] : buildFieldTree(record, descriptors, 'curation')),
    [record, descriptors],
  )
  const nodes = useMemo(() => {
    const map: Record<string, FieldNode | undefined> = {}
    for (const node of flattenFieldTree(tree)) map[node.path] = node
    return map
  }, [tree])
  const descriptorByPath = useMemo(() => {
    const map: Record<string, FieldDescriptor | undefined> = {}
    for (const descriptor of descriptors) map[descriptor.path] = descriptor
    return map
  }, [descriptors])

  async function commitValue(node: FieldNode, value: unknown) {
    if (record === null || savingPath !== null) return
    let next: Record<string, unknown>
    try {
      next = setFieldValue(record, node.path, value)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : `Cannot write ${node.path}.`)
      return
    }
    const root = rootKeyOf(node.path)
    if (root === null) {
      setSaveError(`Cannot address ${node.path} as a top-level field.`)
      return
    }
    setSavingPath(node.path)
    setSaveError(null)
    setNotice(null)
    try {
      const saved = await saveRecord({
        curationId,
        updates: { [root]: getFieldValue(next, root) },
        expectedVersion: recordVersion(record),
      })
      setRecord(Object.keys(saved.record).length > 0 ? saved.record : next)
      setConflict(null)
      setEditingPath(null)
      setInspectorPath(null)
      setNotice(`Saved ${node.label}.`)
    } catch (cause) {
      if (isAdminRequestFailure(cause) && cause.status === 409) {
        // The editor stays open with the reader's text: the draft and the
        // stored value are shown side by side, and nothing is overwritten.
        setConflict({ label: node.label, draft: value, stored: getFieldValue(record, node.path) })
        return
      }
      setSaveError(failureMessage(cause))
    } finally {
      setSavingPath(null)
    }
  }

  async function reloadAfterConflict() {
    setEditingPath(null)
    setInspectorPath(null)
    setConflict(null)
    await reload()
  }

  if (loading && record === null) return <LoadingSurface />
  if (notFound) return <NotFoundSurface curationId={curationId} navigate={navigate} />
  if (record === null) {
    return <ErrorSurface message={loadError ?? 'Curation not found.'} onRetry={() => void reload()} navigate={navigate} />
  }

  const entity = entityContext(record)
  const curator = curatorContext(record)
  const title = asString(record.restaurant_name) ?? entity.name ?? 'Untitled Curation'
  const status = asString(record.status) ?? 'unknown'

  function fieldNode(path: string): FieldNode | null {
    const stored = nodes[path]
    if (stored !== undefined) return stored
    const descriptor = descriptorByPath[path]
    return descriptor === undefined ? null : placeholderNode(descriptor)
  }

  const editorialNodes: FieldNode[] = []
  for (const descriptor of descriptors) {
    if (descriptor.section !== EDITORIAL_SECTION) continue
    const node = fieldNode(descriptor.path)
    if (node !== null) editorialNodes.push(node)
  }
  const restaurantNode = fieldNode('restaurant_name')
  const conceptsNode = fieldNode('categories')
  const transcriptNode = fieldNode('transcript')

  const flexibleNodes: FieldNode[] = []
  for (const node of tree) {
    if (!node.editable || node.system) continue
    if (isStructuredType(node.type)) flexibleNodes.push(node)
  }

  const editProps: CurationSectionEditProps = {
    editingPath,
    savingPath,
    onEdit: (path) => {
      setSaveError(null)
      setConflict(null)
      setEditingPath(path)
    },
    onCancel: () => setEditingPath(null),
    onCommit: (node, value) => {
      void commitValue(node, value)
    },
  }

  return (
    <AdminPage
      className="curation-detail"
      eyebrow="Curations"
      title={title}
      description={`${curator.kind} curation · ${status}`}
      actions={<CurationLink href={LIST_HREF} navigate={navigate}>← All Curations</CurationLink>}
    >
      <CurationRecordHeader record={record} entity={entity} curator={curator} navigate={navigate} />
      {/* One always-present slot: a notice appearing must never remount the
          sections below, or an open editor would lose the draft it holds. */}
      <div className="curation-detail__notices">
        {conflict !== null && (
          <InlineNotice
            tone="error"
            action={<button type="button" onClick={() => void reloadAfterConflict()}>Reload</button>}
          >
            <p>This Curation changed while you were editing it.</p>
            <p>{conflict.label} was not saved. Your draft is still open in the editor below.</p>
            <div className="curation-conflict">
              <div className="curation-conflict__side">
                <h3>Your draft</h3>
                <pre>{readableText(conflict.draft)}</pre>
              </div>
              <div className="curation-conflict__side">
                <h3>Stored value</h3>
                <pre>{readableText(conflict.stored)}</pre>
              </div>
            </div>
          </InlineNotice>
        )}
        {saveError !== null && <InlineNotice tone="error">{saveError}</InlineNotice>}
        {notice !== null && <InlineNotice tone="success">{notice}</InlineNotice>}
      </div>
      <CurationAboutSection
        entity={entity}
        restaurantNode={restaurantNode}
        edit={editProps}
        navigate={navigate}
      />
      <CurationEditorialSection nodes={editorialNodes} edit={editProps} />
      {conceptsNode !== null && (
        <CurationConceptsSection
          node={conceptsNode}
          groups={conceptGroups(record)}
          edit={editProps}
          navigate={navigate}
        />
      )}
      <CurationMediaSection
        buckets={sourceBuckets(record)}
        transcriptNode={transcriptNode}
        edit={editProps}
      />
      <CurationCollectionsSection collections={collections} navigate={navigate} />
      <CurationHistorySection record={record} />
      <CurationAllFieldsSection
        record={record}
        descriptors={descriptors}
        search={search}
        onSearchChange={setSearch}
        editingPath={inspectorPath}
        onRequestEdit={(node) => {
          setSaveError(null)
          setConflict(null)
          setInspectorPath(node.path)
        }}
        onCommitValue={(node, value) => {
          void commitValue(node, value)
        }}
        onCancelEdit={() => setInspectorPath(null)}
      />
      <CurationAdvancedSection record={record} flexible={flexibleNodes} edit={editProps} />
    </AdminPage>
  )
}
