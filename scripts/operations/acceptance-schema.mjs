export const COLLECTIONS_ACCEPTANCE_CRITERIA = Object.freeze([
  [1, 'Collection is a first-class aggregate, never a Curation category field.'],
  [2, 'Slug is unique and immutable after first publish.'],
  [3, 'Membership scales without giant arrays or editorial ordering.'],
  [4, 'Editing a published Collection changes only the draft until publish.'],
  [5, 'Publish is asynchronous, resumable and atomically promotes a new version.'],
  [6, 'Published versions remain accessible while the Collection is active.'],
  [7, 'Archive returns 410 for public current/exact/dump reads and restore recovers the same version.'],
  [8, 'Curation and Entity changes hydrate live without creating a Collection version.'],
  [9, 'Unavailable members are omitted and reflected in selected/available/unavailable counts.'],
  [10, 'Admin can list/filter/select large result sets without loading them all in the browser.'],
  [11, 'Select-all uses an immutable, auditable server-side manifest.'],
  [12, 'Bulk effects are atomic per Collection, idempotent and resumable after crash.'],
  [13, 'Same-Collection mutations are serialized while different Collections can run in parallel.'],
  [14, 'Collector shows published associations to authenticated users and draft actions only to admins.'],
  [15, 'Collections remain online-only and do not alter existing offline behavior.'],
  [16, 'Consumer applications use individually revocable credentials and Collection allowlists.'],
  [17, 'Distribution/dumps expose only normalized public DTOs, never raw documents.'],
  [18, 'Payload and FastAPI retain separate ownership and database credentials.'],
  [19, 'CMS handoff shares no HS256 secret, domain cookie or persistent browser token.'],
  [20, 'Concurrency, crash, load, security and contract gates pass before rollout.'],
].map(([id, description]) => ({ id, description })))

export const ACCEPTANCE_SCHEMA_VERSION = 1

const SHA_RE = /^[a-f0-9]{40}$/i

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

export function validateCollectionsAcceptanceEvidence(value, options = {}) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['evidence must be a JSON object']
  if (value.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ACCEPTANCE_SCHEMA_VERSION}`)
  if (value.environment !== 'staging') errors.push('environment must be staging')
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt must be an ISO date')
  if (typeof value.commitSha !== 'string' || !SHA_RE.test(value.commitSha)) errors.push('commitSha must be a 40-character Git SHA')
  if (options.expectedCommit && value.commitSha !== options.expectedCommit) errors.push(`commitSha does not match expected commit ${options.expectedCommit}`)
  if (!nonEmptyStrings(value.runtimeGates)) errors.push('runtimeGates must contain at least one executed gate reference')

  const criteria = Array.isArray(value.criteria) ? value.criteria : []
  if (criteria.length !== COLLECTIONS_ACCEPTANCE_CRITERIA.length) {
    errors.push(`criteria must contain exactly ${COLLECTIONS_ACCEPTANCE_CRITERIA.length} entries`)
  }
  const byId = new Map()
  for (const criterion of criteria) {
    if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) {
      errors.push('each criterion must be an object')
      continue
    }
    if (!Number.isInteger(criterion.id)) {
      errors.push('criterion id must be an integer')
      continue
    }
    if (byId.has(criterion.id)) errors.push(`criterion ${criterion.id} is duplicated`)
    byId.set(criterion.id, criterion)
  }

  for (const expected of COLLECTIONS_ACCEPTANCE_CRITERIA) {
    const criterion = byId.get(expected.id)
    if (!criterion) {
      errors.push(`criterion ${expected.id} is missing`)
      continue
    }
    if (criterion.status !== 'pass') errors.push(`criterion ${expected.id} must have status=pass`)
    if (!nonEmptyStrings(criterion.evidence)) errors.push(`criterion ${expected.id} requires non-empty evidence references`)
    if (typeof criterion.notes === 'string' && criterion.notes.length > 4000) errors.push(`criterion ${expected.id} notes exceed 4000 characters`)
  }

  return errors
}
