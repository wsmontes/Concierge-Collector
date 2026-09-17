/**
 * Valor ausente, marcado.
 *
 * Um registro sem dado não é uma célula vazia: o vazio parece "não carregou" e o
 * operador não distingue "o campo não existe" de "a leitura falhou". Aqui é um
 * traço visível com o significado em texto para leitor de tela.
 */
export function NoValue({ label = 'no value' }: { label?: string }) {
  return (
    <span className="ui-no-value">
      <span aria-hidden="true">—</span>
      <span className="ui-visually-hidden">{label}</span>
    </span>
  )
}
