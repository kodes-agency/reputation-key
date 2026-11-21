// Clipboard write with a legacy fallback for non-secure contexts.
// navigator.clipboard.writeText rejects on HTTP, sandboxed iframes, and older
// browsers — fall back to a hidden <textarea> + document.execCommand('copy').
// Returns whether the copy succeeded so callers can surface a failure.

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }

  if (typeof document === 'undefined') return false

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export type ResolvedCopyOutcome =
  | Readonly<{ status: 'copied' }>
  /** The text arrived but the browser refused it; the caller can show it. */
  | Readonly<{ status: 'failed'; text: string }>
  /** There was no text to copy (its own error already says why). */
  | Readonly<{ status: 'unresolved' }>

const supportsAsyncClipboardWrite = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator.clipboard?.write === 'function' &&
  typeof window !== 'undefined' &&
  window.isSecureContext

/**
 * Copies text that arrives after a wait, such as an address fetched from the
 * server when the button is pressed. Safari lets a clipboard write through only
 * while the click's user activation is alive, and a network wait outlasts it, so
 * the write is started at once with a promise for the text. Where that is not
 * supported, or is refused, the text is awaited and written the ordinary way.
 * Call it from the click handler without awaiting anything first.
 */
export async function copyResolvedText(
  resolve: () => Promise<string | null>,
): Promise<ResolvedCopyOutcome> {
  const pending = resolve()
  if (supportsAsyncClipboardWrite()) {
    try {
      const blob = pending.then((text) => {
        if (text === null) throw new Error('nothing to copy')
        return new Blob([text], { type: 'text/plain' })
      })
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return { status: 'copied' }
    } catch {
      // Refused, or nothing arrived: settle which below.
    }
  }
  const text = await pending.catch(() => null)
  if (text === null) return { status: 'unresolved' }
  return (await copyToClipboard(text)) ? { status: 'copied' } : { status: 'failed', text }
}
