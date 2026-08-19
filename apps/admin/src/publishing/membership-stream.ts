import type { Model } from 'mongoose'

type DocumentModel = Model<Record<string, unknown>>
type StreamDocument = Record<string, unknown>

function asCursor(value: unknown): AsyncIterable<StreamDocument> {
  return value as AsyncIterable<StreamDocument>
}

async function next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return iterator.next()
}

/**
 * Produces the frozen draft selection in technical curationId order without
 * materializing all selected IDs.  It merges published intervals with the
 * latest visible liquid delta for each Curation.
 */
export async function* streamDraftMembershipIds(input: {
  memberships: DocumentModel
  changes: DocumentModel
  collectionId: string
  baseVersion: number | null
  draftEpoch: string
  draftRevision: number
}): AsyncGenerator<string> {
  const membershipCursor = input.baseVersion === null
    ? (async function* () {})()
    : asCursor(input.memberships.find({
      collectionId: input.collectionId,
      addedInVersion: { $lte: input.baseVersion },
      $or: [{ removedInVersion: null }, { removedInVersion: { $gt: input.baseVersion } }],
    }).sort({ curationId: 1 }).cursor())
  const changeCursor = asCursor(input.changes.find({
    collectionId: input.collectionId,
    draftEpoch: input.draftEpoch,
    stageState: 'committed',
    targetDraftRevision: { $lte: input.draftRevision },
    $or: [{ validUntilDraftRevision: null }, { validUntilDraftRevision: { $gte: input.draftRevision } }],
  }).sort({ curationId: 1, targetDraftRevision: -1 }).cursor())

  const memberIterator = membershipCursor[Symbol.asyncIterator]()
  const changeIterator = changeCursor[Symbol.asyncIterator]()
  let member = await next(memberIterator)
  let change = await next(changeIterator)
  let previousChangeId: string | undefined

  while (!member.done || !change.done) {
    const memberId = member.done ? undefined : String(member.value.curationId)
    const changeId = change.done ? undefined : String(change.value.curationId)
    if (changeId === previousChangeId) {
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
