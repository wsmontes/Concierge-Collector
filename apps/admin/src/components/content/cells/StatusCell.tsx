'use client'

import type { DefaultCellComponentProps } from 'payload'
import { StatusPill } from '../../ui/StatusPill'
import { asDisplayText, toInstant } from './cell-value'
import { useNow } from '../../ui/useNow'

/**
 * Estado das collections nativas, com o vocabulário de tom do kit.
 *
 * A lista nativa mostrava o valor cru do select (`active`, `revoked`) com a
 * mesma aparência de qualquer texto — nada na tela dizia "isto está bem" ou
 * "isto não vale mais". Pior: uma credencial `active` cujo `expiresAt` já passou
 * aparece na lista como ativa, porque o select não sabe do relógio. O estado
 * efetivo é derivado uma vez, aqui, e o `data-status` da pílula passa a carregar
 * o estado que a lista realmente mostra.
 */

/** `active` | `suspended` de uma application do consumidor. */
export function ApplicationStatusCell({ rowData }: DefaultCellComponentProps) {
  return <StatusPill status={asDisplayText(rowData?.status) ?? 'unknown'} />
}

/**
 * `active` | `revoked` de uma credencial, com `expired` derivado do `expiresAt`.
 *
 * A precedência é deliberada: revogação vence expiração. Uma credencial revogada
 * não volta a valer quando a validade vencer, então mostrá-la como expirada
 * esconderia a ação que de fato a desligou.
 */
/**
 * O "agora" é estado EXTERNO ao React, então ele não pode ser lido no render
 * (`Date.now()` durante o render é impuro e o compilador do React recusa — com
 * razão: duas renderizações do mesmo dado dariam resultados diferentes).
 * O relógio entra por um efeito, com um temporizador que também faz o chip
 * virar `expired` sozinho enquanto a lista está aberta, sem recarregar a página.
 */
export function CredentialStatusCell({ rowData }: DefaultCellComponentProps) {
  const status = asDisplayText(rowData?.status) ?? 'unknown'
  const expiresAt = toInstant(rowData?.expiresAt)
  const expired = useExpiryChip(status, expiresAt)

  return <StatusPill status={expired ? 'expired' : status} />
}

/** `true` quando uma credencial ativa já passou da validade — checado fora do render. */
function useExpiryChip(status: string, expiresAt: number | null): boolean {
  // O "agora" vem de um store externo (um intervalo por PÁGINA, não por célula):
  // ler o relógio no render seria impuro e o compilador do React recusa; um
  // efeito com temporizador evitaria a impureza mas piscaria o chip no primeiro
  // quadro. Ver `components/ui/useNow.ts`.
  const now = useNow()
  return status === 'active' && expiresAt !== null && now !== null && expiresAt <= now
}
