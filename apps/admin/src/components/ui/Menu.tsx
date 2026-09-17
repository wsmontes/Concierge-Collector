'use client'

import { Popup } from '@payloadcms/ui'
import type { ReactNode } from 'react'

export interface MenuItemSpec {
  /** `true` desenha só um separador entre grupos de ações. */
  separator?: true
  label?: string
  hint?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  onSelect?: () => void
  /**
   * Ação sem JavaScript: o item vira `type="submit"` de um `<form>` oculto com
   * este `action`/`method`. É como o logout funciona — ele precisa de um POST
   * autenticado que apaga o cookie `cms_session` no servidor, e um `fetch`
   * client-side não consegue apagar cookie HttpOnly.
   */
  submit?: { action: string; method?: 'get' | 'post' }
}

/**
 * Menu de ações. O `Popup` do Payload renderiza num portal, posiciona acima ou
 * abaixo do gatilho conforme o espaço, inverte perto da borda da viewport e
 * fecha com `Esc`/clique fora — três comportamentos que os menus caseiros da
 * navegação não tinham.
 *
 * `render` recebe o `close` do próprio popup: selecionar uma ação fecha o menu
 * de forma explícita, em vez de depender do comportamento interno do componente.
 */
export function Menu({
  label,
  trigger,
  items,
  align = 'bottom',
  size = 'small',
}: {
  label: string
  trigger: ReactNode
  items: MenuItemSpec[]
  align?: 'bottom' | 'top'
  size?: 'fit-content' | 'large' | 'medium' | 'small'
}) {
  return (
    <Popup
      button={trigger}
      buttonType="custom"
      noBackground
      render={({ close }) => (
        <div aria-label={label} className="ui-menu" role="menu">
          {items.map((item, index) => {
            if (item.separator) return <hr className="ui-menu__separator" key={`separator-${index}`} />
            const formId = `ui-menu-form-${index}`
            return (
              <span key={`${item.label}-${index}`} style={{ display: 'contents' }}>
                {item.submit && (
                  <form action={item.submit.action} hidden id={formId} method={item.submit.method ?? 'post'} />
                )}
                <button
                  className="ui-menu__item"
                  data-tone={item.tone ?? 'default'}
                  disabled={item.disabled}
                  form={item.submit ? formId : undefined}
                  onClick={
                    item.submit
                      ? undefined
                      : () => {
                          close()
                          item.onSelect?.()
                        }
                  }
                  role="menuitem"
                  type={item.submit ? 'submit' : 'button'}
                >
                  <span>{item.label}</span>
                  {item.hint && <kbd className="ui-keyhint">{item.hint}</kbd>}
                </button>
              </span>
            )
          })}
        </div>
      )}
      size={size}
      verticalAlign={align}
    />
  )
}
