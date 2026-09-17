import { FactList } from '../ui/Card'

export interface TechnicalDetail {
  term: string
  value: string
}

/**
 * The raw identifiers of one row, behind a collapsed disclosure.
 *
 * Humanized rows keep their ids reachable for support and debugging without
 * letting them be the thing the editor reads first; an empty detail set renders
 * nothing at all rather than an empty disclosure.
 */
export function TechnicalDetails({ details, label = 'Technical details' }: { details: readonly TechnicalDetail[]; label?: string }) {
  if (details.length === 0) return null
  return (
    <details className="collection-technical">
      <summary>{label}</summary>
      <FactList
        facts={details.map((detail) => ({
          label: detail.term,
          value: <code>{detail.value}</code>,
        }))}
      />
    </details>
  )
}
