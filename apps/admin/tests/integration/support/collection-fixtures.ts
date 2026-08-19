import { ObjectId, type Db } from 'mongodb'

function objectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error(`Invalid ObjectId: ${id}`)
  return new ObjectId(id)
}

/** Reads only the committed, revision-bounded delta projection used by draft views. */
export async function visibleDraftChanges(db: Db, collectionId: string) {
  const collection = await db.collection('collections').findOne({ _id: objectId(collectionId) })
  if (!collection) throw new Error(`Collection not found: ${collectionId}`)
  const committed = await db.collection('collection_operations').find({
    collectionId,
    status: 'committed',
  }, { projection: { _id: 1 } }).toArray()
  return db.collection('collection_draft_changes').aggregate([
    {
      $match: {
        collectionId,
        draftEpoch: collection.draftEpoch,
        stageState: 'committed',
        targetDraftRevision: { $lte: collection.draftRevision },
        $or: [
          { validUntilDraftRevision: null },
          { validUntilDraftRevision: { $gte: collection.draftRevision } },
        ],
        operationId: { $in: committed.map((operation) => String(operation._id)) },
      },
    },
    { $sort: { curationId: 1, targetDraftRevision: -1, operationSequence: -1 } },
    { $group: { _id: '$curationId', change: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$change' } },
    { $sort: { curationId: 1 } },
  ]).toArray()
}

export async function loadOperation(db: Db, operationId: string) {
  return db.collection('collection_operations').findOne({ _id: objectId(operationId) })
}

export async function loadCollection(db: Db, collectionId: string) {
  return db.collection('collections').findOne({ _id: objectId(collectionId) })
}
