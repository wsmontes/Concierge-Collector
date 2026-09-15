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
      <dl className="collection-technical__list">
        {details.map((detail) => (
          <div key={detail.term}>
            <dt>{detail.term}</dt>
            <dd><code>{detail.value}</code></dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
