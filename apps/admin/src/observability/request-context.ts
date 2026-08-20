import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  actorId?: string
  collectionId?: string
  operationId?: string
  publishJobId?: string
  requestId: string
  selectionId?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

export function withRequestContext<T>(input: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ ...input }, fn)
}
