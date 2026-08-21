import type { CollectionConfig } from 'payload'

/**
 * Operational liveness records written exclusively by the Payload worker.
 *
 * The web process can read the latest row through its dedicated health route,
 * but no browser or Payload Admin request can access this collection.
 */
export const WorkerHeartbeats: CollectionConfig = {
  slug: 'worker-heartbeats',
  dbName: 'worker_heartbeats',
  admin: {
    hidden: true,
  },
  access: {
    admin: () => false,
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  indexes: [{ fields: ['workerId', 'observedAt'] }],
  fields: [
    {
      name: 'workerId',
      type: 'text',
      required: true,
    },
    {
      name: 'observedAt',
      type: 'date',
      required: true,
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
    },
  ],
}
