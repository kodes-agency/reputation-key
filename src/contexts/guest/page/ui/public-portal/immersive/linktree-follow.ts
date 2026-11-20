import type { SelectSecondaryLinkAction } from '../guest-response-form-types'

/** Counts in the background; the tile's anchor owns navigation. */
export type LinktreeTapCounter = (linkId: string) => void

/** Every bound session can count a tap; an inert preview has no handler. */
export function bindLinkTapCounter(
  input: Readonly<{
    token?: string
    csrfNonce?: string
    selectSecondaryLink?: SelectSecondaryLinkAction
  }>,
): LinktreeTapCounter | undefined {
  const { token, csrfNonce, selectSecondaryLink } = input
  if (!token || !csrfNonce || !selectSecondaryLink) return undefined
  return (linkId) => {
    void selectSecondaryLink({
      data: { token, csrfNonce, linkId },
      fetch: (input, init) => fetch(input, { ...init, keepalive: true }),
    }).catch(() => {
      // The guest is already on their way; the server reports a lost observation.
    })
  }
}

/** Whether `value` is an absolute https URL: the only kind of website a guest is sent to. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
