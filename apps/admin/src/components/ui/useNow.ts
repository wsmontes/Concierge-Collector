'use client'

import { useSyncExternalStore } from 'react'

/**
 * O "agora" como estado EXTERNO — a forma que o React aceita para ler o relógio.
 *
 * Duas alternativas foram descartadas com motivo:
 *
 * - `Date.now()` no render é impuro: duas renderizações do mesmo dado dariam
 *   resultados diferentes, e o compilador do React recusa (com razão).
 * - `useState` + efeito com `setTimeout(0)` corrige a impureza mas PISCA: a
 *   primeira pintura mostra o estado anterior, então uma credencial vencida
 *   aparece como "Active" por um quadro antes de virar "Expired".
 *
 * `useSyncExternalStore` resolve as duas: a leitura de tempo vive no contrato do
 * store (que é onde ela pertence), a primeira renderização no servidor usa um
 * valor fixo (sem mismatch de hidratação) e o cliente se atualiza em seguida.
 *
 * O store é de MÓDULO, então uma lista com cem células tem UM intervalo — não
 * cem. E ele só existe enquanto há quem leia.
 */

const TICK_MS = 60_000

let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, TICK_MS)
    timer.unref?.()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** Um minuto é a resolução: validade de credencial é dada em data/hora. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  )
}
