import { AdminHttpError } from '../http/errors'

type OperationValue = Record<string, unknown>

function idOf(value: OperationValue): string {
  return String(value.id ?? value._id)
}

/** Operation history is private to the live admin that created the intent. */
export function assertOperationOwnedBy(operation: OperationValue, actorId: string): void {
  if (String(operation.actorId ?? '') !== actorId) throw new AdminHttpError(404, 'not_found')
}

/** Allowlisted standalone-operation DTO; worker/idempotency/fence fields stay server-side. */
export function publicStandaloneOperation(operation: OperationValue) {
  return {
    id: idOf(operation),
    collectionId: operation.collectionId ?? null,
    mode: operation.mode ?? null,
    action: operation.action ?? null,
    status: operation.status ?? null,
    progress: operation.progress ?? null,
    checkpoint: operation.checkpoint ?? null,
    errorCode: operation.errorCode ?? null,
    selectedCount: operation.selectedCount ?? null,
    targetDraftRevision: operation.targetDraftRevision ?? null,
    createdAt: operation.createdAt ?? null,
    updatedAt: operation.updatedAt ?? null,
  }
}
