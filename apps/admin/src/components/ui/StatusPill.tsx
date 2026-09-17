import { Chip, humanizeStatus, statusTone } from './Chip'

/**
 * Estado de domínio legível. O `data-status` fica no elemento externo de
 * propósito: é o contrato que as telas e os testes já liam para saber o estado
 * de uma linha, independente do desenho do chip.
 */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className="admin-status" data-status={status}>
      <Chip size="sm" tone={statusTone(status)}>
        {label ?? humanizeStatus(status)}
      </Chip>
    </span>
  )
}
