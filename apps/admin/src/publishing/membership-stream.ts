import type { ClientSession, Model } from 'mongoose'

type DocumentModel = Model<Record<string, unknown>>
type StreamDocument = Record<string, unknown>

function asCursor(value: unknown): AsyncIterable<StreamDocument> {
  return value as AsyncIterable<StreamDocument>
}

async function next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return iterator.next()
}

/** Entrada compartilhada pelas leituras da membership do draft. */
export interface DraftMembershipQuery {
  memberships: DocumentModel
  changes: DocumentModel
  collectionId: string
  baseVersion: number | null
  draftEpoch: string
  draftRevision: number
  /** Dentro de uma transação as leituras precisam enxergar as escritas dela. */
  session?: ClientSession
}

/**
 * Produces the frozen draft selection in technical curationId order without
 * materializing all selected IDs.  It merges published intervals with the
 * latest visible liquid delta for each Curation.
 */
export async function* streamDraftMembershipIds(input: DraftMembershipQuery): AsyncGenerator<string> {
  const membershipQuery = input.memberships.find({
    collectionId: input.collectionId,
    addedInVersion: { $lte: input.baseVersion },
    $or: [{ removedInVersion: null }, { removedInVersion: { $gt: input.baseVersion } }],
  }).sort({ curationId: 1 })
  const changeQuery = input.changes.find({
    collectionId: input.collectionId,
    draftEpoch: input.draftEpoch,
    stageState: 'committed',
    targetDraftRevision: { $lte: input.draftRevision },
    $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: input.draftRevision } }],
  }).sort({ curationId: 1, targetDraftRevision: -1 })
  if (input.session) {
    membershipQuery.session(input.session)
    changeQuery.session(input.session)
  }
  const membershipCursor = input.baseVersion === null
    ? (async function* () {})()
    : asCursor(membershipQuery.cursor())
  const changeCursor = asCursor(changeQuery.cursor())

  const memberIterator = membershipCursor[Symbol.asyncIterator]()
  const changeIterator = changeCursor[Symbol.asyncIterator]()
  let member = await next(memberIterator)
  let change = await next(changeIterator)
  let previousChangeId: string | undefined

  while (!member.done || !change.done) {
    const memberId = member.done ? undefined : String(member.value.curationId)
    const changeId = change.done ? undefined : String(change.value.curationId)
    if (changeId !== undefined && changeId === previousChangeId) {
      change = await next(changeIterator)
      continue
    }
    if (memberId !== undefined && (changeId === undefined || memberId < changeId)) {
      yield memberId
      member = await next(memberIterator)
      continue
    }
    if (changeId !== undefined && (memberId === undefined || changeId < memberId)) {
      if (change.value.desiredState === 'add') yield changeId
      previousChangeId = changeId
      change = await next(changeIterator)
      continue
    }
    // Same id: the delta is authoritative relative to the published interval.
    if (changeId !== undefined && change.value.desiredState === 'add') yield changeId
    previousChangeId = changeId
    member = await next(memberIterator)
    change = await next(changeIterator)
  }
}

/**
 * Só o tamanho da seleção do draft, pela MESMA definição de
 * `streamDraftMembershipIds` e sem materializar os ids.
 */
export async function countDraftMembership(input: DraftMembershipQuery): Promise<number> {
  const iterator = streamDraftMembershipIds(input)
  let count = 0
  while (!(await iterator.next()).done) count += 1
  return count
}

export async function* streamMembershipAtVersion(input: {
  memberships: DocumentModel
  collectionId: string
  version: number
}): AsyncGenerator<string> {
  const cursor = asCursor(input.memberships.find({
    collectionId: input.collectionId,
    addedInVersion: { $lte: input.version },
    $or: [{ removedInVersion: null }, { removedInVersion: { $gt: input.version } }],
  }).sort({ curationId: 1 }).cursor())
  for await (const document of cursor) yield String(document.curationId)
}

export interface MembershipDelta {
  curationId: string
  action: 'add' | 'remove'
}

/**
 * Merge-diffs the membership frozen at two versions without materializing
 * either set in memory. Both streams are sorted by curationId, so a single
 * cursor walk yields the symmetric difference: ids present in the historical
 * version but absent from the base become 'add' deltas, ids present in the
 * base but absent from the historical become 'remove' deltas.
 */
export async function* diffMembershipAtVersions(input: {
  memberships: DocumentModel
  collectionId: string
  version: number
  baseVersion: number
}): AsyncGenerator<MembershipDelta> {
  const historical = streamMembershipAtVersion({ memberships: input.memberships, collectionId: input.collectionId, version: input.version })[Symbol.asyncIterator]()
  const base = streamMembershipAtVersion({ memberships: input.memberships, collectionId: input.collectionId, version: input.baseVersion })[Symbol.asyncIterator]()
  let left = await next(historical)
  let right = await next(base)
  let previousLeft: string | undefined
  let previousRight: string | undefined
  while (!left.done || !right.done) {
    const leftId = left.done ? undefined : String(left.value)
    const rightId = right.done ? undefined : String(right.value)
    if (leftId !== undefined && leftId === previousLeft) {
      left = await next(historical)
      continue
    }
    if (rightId !== undefined && rightId === previousRight) {
      right = await next(base)
      continue
    }
    if (leftId !== undefined && (rightId === undefined || leftId < rightId)) {
      yield { curationId: leftId, action: 'add' }
      previousLeft = leftId
      left = await next(historical)
      continue
    }
    if (rightId !== undefined && (leftId === undefined || rightId < leftId)) {
      yield { curationId: rightId, action: 'remove' }
      previousRight = rightId
      right = await next(base)
      continue
    }
    // Present in both versions: no delta.
    previousLeft = leftId
    previousRight = rightId
    left = await next(historical)
    right = await next(base)
  }
}

export async function inspectAvailability(
  curationIds: AsyncIterable<string>,
  hydrate: (ids: string[]) => Promise<{ availableCount: number; unavailableCount: number }>,
): Promise<{ selectedCount: number; availableCount: number; unavailableCount: number }> {
  const batch: string[] = []
  let selectedCount = 0
  let availableCount = 0
  let unavailableCount = 0
  const flush = async () => {
    if (!batch.length) return
    const result = await hydrate(batch.splice(0, batch.length))
    availableCount += result.availableCount
    unavailableCount += result.unavailableCount
  }
  for await (const curationId of curationIds) {
    batch.push(curationId)
    selectedCount += 1
    if (batch.length === 500) await flush()
  }
  await flush()
  return { selectedCount, availableCount, unavailableCount }
}
