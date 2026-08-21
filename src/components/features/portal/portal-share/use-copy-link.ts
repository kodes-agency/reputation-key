// Copy state for the one-time opaque portal link, shared by the share tab and
// the QR modal so both surface the same failure.
//
// `copyToClipboard` deliberately returns false instead of throwing (see the
// contract note in src/lib/clipboard.ts) — it fails on insecure origins, in
// sandboxed iframes, and when clipboard permission is denied. Swallowing that
// makes the button a silent no-op, and an operator printing a QR batch then
// pastes whatever was already on the clipboard over a fresh code. On failure we
// say so and select the rendered link so the user can copy it by hand; the raw
// URL is shown only once, so there is no second chance to retrieve it.

import { useCallback, useRef, useState } from 'react'
import { copyToClipboard } from '#/lib/clipboard'
import type { RefObject } from 'react'

const COPIED_RESET_MS = 2000

function selectElementText(element: HTMLElement | null) {
  if (!element || typeof window === 'undefined') return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

export type CopyLinkState = Readonly<{
  /** Attach to the element rendering the URL so a failed copy can select it. */
  linkRef: RefObject<HTMLElement | null>
  copied: boolean
  copyFailed: boolean
  copyLink: () => Promise<void>
}>

export function useCopyLink(publicUrl: string | null): CopyLinkState {
  const linkRef = useRef<HTMLElement | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const copyLink = useCallback(async () => {
    if (!publicUrl) return
    if (await copyToClipboard(publicUrl)) {
      setCopyFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
      return
    }
    setCopied(false)
    setCopyFailed(true)
    selectElementText(linkRef.current)
  }, [publicUrl])

  return { linkRef, copied, copyFailed, copyLink } as const
}

export const COPY_FAILED_MESSAGE =
  'Copy failed — this browser blocked clipboard access. The link text is now selected; copy it manually before leaving this page.'
