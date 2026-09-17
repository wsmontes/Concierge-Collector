import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useNow } from '../../../../src/components/ui/useNow'

/**
 * O relógio do hook é estado de MÓDULO: ele nasce quando o chunk carrega, não
 * quando a lista passa a ler. Sem atualizar na assinatura, a primeira pintura de
 * uma lista aberta minutos depois do carregamento usava um "agora" velho — e uma
 * credencial que venceu nesse intervalo aparecia como ativa por até um minuto,
 * que é o intervalo do tick.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Probe() {
  return <span data-testid="now">{useNow()}</span>
}

test('a primeira pintura depois de um longo ocioso usa o relógio de agora', () => {
  vi.useFakeTimers()
  // Cinco minutos com o módulo carregado e nenhum leitor: nada atualiza `now`,
  // porque o intervalo só existe enquanto há inscritos.
  vi.advanceTimersByTime(5 * 60_000)

  const { getByTestId } = render(<Probe />)

  expect(Number(getByTestId('now').textContent)).toBe(Date.now())
})
