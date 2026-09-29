/** The registered Admin routes for content records (see `admin.components.views`). */

export function curationRecordPath(curationId: string): string {
  return `/admin/curations/${encodeURIComponent(curationId)}`
}

export function entityRecordPath(entityId: string): string {
  return `/admin/entities/${encodeURIComponent(entityId)}`
}
