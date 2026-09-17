import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { DataTable, type DataTableColumn } from '../../../../src/components/ui/DataTable'

/**
 * A tabela do kit recebe o `keydown` de tudo que está DENTRO de uma célula
 * (o handler mora no `<table>`, o evento borbulha). Sem guarda, Espaço num
 * controle marca a linha duas vezes e as setas movem a linha ativa enquanto o
 * operador navega no controle.
 *
 * O que este arquivo prova: a guarda cobre TODO controle, e não só `input` e
 * `button` — `select` e `textarea` ficaram de fora por um `instanceof` por tipo.
 */

afterEach(() => cleanup())

type Row = { id: string; name: string }

const rows: Row[] = [
  { id: 'r1', name: 'Primeira' },
  { id: 'r2', name: 'Segunda' },
]

function columns(): Array<DataTableColumn<Row>> {
  return [
    { key: 'name', header: 'Name', cell: (row) => row.name },
    {
      key: 'controls',
      header: 'Controls',
      cell: () => (
        <>
          <select aria-label="Lifecycle">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <textarea aria-label="Note" />
        </>
      ),
    },
  ]
}

function renderTable() {
  return render(
    <DataTable
      caption="Curations"
      columns={columns()}
      rowKey={(row) => row.id}
      rows={rows}
    />,
  )
}

function activeRowKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-row][data-active="true"]')).map(
    (row) => row.getAttribute('data-row-key') ?? '',
  )
}

test('as setas movem a linha ativa quando o foco está na própria tabela', () => {
  const { container } = renderTable()
  const table = screen.getByRole('table', { name: 'Curations' })

  fireEvent.keyDown(table, { key: 'ArrowDown' })
  expect(activeRowKeys(container)).toEqual(['r1'])

  fireEvent.keyDown(table, { key: 'ArrowDown' })
  expect(activeRowKeys(container)).toEqual(['r2'])
})

test('navegar dentro de um select ou de um textarea não move a linha ativa', () => {
  const { container } = renderTable()

  for (const label of ['Lifecycle', 'Note']) {
    // O controle existe em toda linha; qualquer um deles serve.
    const control = screen.getAllByLabelText(label)[0]
    control.focus()

    fireEvent.keyDown(control, { key: 'ArrowDown' })
    fireEvent.keyDown(control, { key: 'ArrowUp' })
    fireEvent.keyDown(control, { key: 'End' })
    fireEvent.keyDown(control, { key: 'Home' })

    // Nenhuma linha virou a ativa: o teclado é do controle, não da tabela.
    expect(activeRowKeys(container), `após navegar em ${label}`).toEqual([])
  }
})
