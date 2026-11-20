// Copy state for the portal link, shared by the share tab and the QR modal so
// both surface the same failure.
//
// `copyToClipboard` deliberately returns false instead of throwing (see the
// contract note in src/lib/clipboard.ts) — it fails on insecure origins, in
// sandboxed iframes, and when clipboard permission is denied. Swallowing that
// makes the button a silent no-op, and an operator printing a QR batch then
// pastes whatever was already on the clipboard over a fresh code. On failure we
// say so and select the rendered link so the user can copy it by hand.

import { useCallback, useEffect, useRef, useState } from 'react'
import { copyResolvedText, copyToClipboard } from '#/lib/clipboard'
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
  /** Copies the link. */
  copyLink: () => Promise<void>
  /**
   * Copies an address the caller fetches on this click. Call it straight from the
   * click handler: the clipboard write starts before the address arrives, which
   * is what keeps it allowed in Safari.
   */
  copyFetchedLink: (fetchAddress: () => Promise<string | null>) => Promise<void>
}>

export function useCopyLink(publicUrl: string | null): CopyLinkState {
  const linkRef = useRef<HTMLElement | null>(null)
  const [copied, setCopied] = useState(false)
  const [failedCopies, setFailedCopies] = useState(0)
  const [copyFailed, setCopyFailed] = useState(false)

  // Selected once the link text is on screen: a fetched address renders only
  // after the fetch that a failed copy followed.
  useEffect(() => {
    if (failedCopies > 0) selectElementText(linkRef.current)
  }, [failedCopies, publicUrl])

  const succeeded = useCallback(() => {
    setCopyFailed(false)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }, [])

  const failed = useCallback(() => {
    setCopied(false)
    setCopyFailed(true)
    setFailedCopies((count) => count + 1)
  }, [])

  const copyLink = useCallback(async () => {
    if (!publicUrl) return
    if (await copyToClipboard(publicUrl)) succeeded()
    else failed()
  }, [publicUrl, succeeded, failed])

  const copyFetchedLink = useCallback(
    async (fetchAddress: () => Promise<string | null>) => {
      const outcome = await copyResolvedText(fetchAddress)
      if (outcome.status === 'copied') succeeded()
      else if (outcome.status === 'failed') failed()
    },
    [succeeded, failed],
  )

  return { linkRef, copied, copyFailed, copyLink, copyFetchedLink } as const
}

export const COPY_FAILED_MESSAGE =
  'Copy failed — this browser blocked clipboard access. The link text is now selected; copy it manually before leaving this page.'
