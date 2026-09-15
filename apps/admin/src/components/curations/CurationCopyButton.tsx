'use client'

import { useState } from 'react'

/**
 * Copies stored text to the clipboard. The transcript and the raw record are
 * both "readable and copyable" by requirement, and a reader who has to select a
 * 400-line block by hand is not being served. Clipboard access is optional in a
 * browser and absent in tests, so an unavailable clipboard reports itself
 * instead of throwing.
 */
export function CurationCopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'unavailable'>('idle')

  async function copy() {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      setState('unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('unavailable')
    }
  }

  return (
    <span className="curation-copy">
      <button type="button" onClick={() => void copy()}>{label}</button>
      {state === 'copied' && <span role="status">Copied.</span>}
      {state === 'unavailable' && <span role="status">This browser will not copy for the page; select the text instead.</span>}
    </span>
  )
}
