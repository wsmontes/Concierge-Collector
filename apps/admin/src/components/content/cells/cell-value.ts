/**
 * Normalização de valor de célula — o ponto único onde um valor cru do Payload
 * vira texto (ou nulo) para as células das collections nativas.
 *
 * Um campo de data chega como `Date` (Local API), número (epoch) ou string ISO
 * (REST/serializado); um campo de texto chega como string ou `undefined`. Sem
 * esta normalização cada célula repetiria a mesma dança de `typeof` e uma delas
 * divergiria — foi assim que o Admin acumulou três gramáticas de tabela.
 *
 * Responsabilidade: conversão de valor. Nada de apresentação — quem decide o
 * desenho é o componente de célula.
 */

/** Texto apresentável de um valor de campo; `null` quando não há o que mostrar. */
export function asDisplayText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()

  const text = String(value)
  return text === '' ? null : text
}

/** Instante em milissegundos de um valor de data; `null` quando não é uma data válida. */
export function toInstant(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()

  const text = asDisplayText(value)
  if (text === null) return null

  const instant = Date.parse(text)
  return Number.isNaN(instant) ? null : instant
}
