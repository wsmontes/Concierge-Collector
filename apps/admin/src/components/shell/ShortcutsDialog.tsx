'use client'

import { Dialog } from '../ui/Dialog'
import type { ShortcutSpec } from './admin-ui'

/**
 * Ajuda de atalhos. Existe para que o teclado seja descobrível: uma lista que
 * só aparece no código não é descoberta por ninguém. As linhas vêm de
 * `ADMIN_SHORTCUTS`, que descreve só o que está implementado.
 */
export function ShortcutsDialog({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean
  onClose: () => void
  shortcuts: ShortcutSpec[]
}) {
  return (
    <Dialog onClose={onClose} open={open} title="Keyboard shortcuts" width="28rem">
      <dl className="ui-facts">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.keys} style={{ display: 'contents' }}>
            <dt>
              <kbd className="ui-keyhint">{shortcut.keys}</kbd>
            </dt>
            <dd>{shortcut.description}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
