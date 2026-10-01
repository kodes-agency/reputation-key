import type { GuestResponseAction } from '../guest-response-form-types'

/** Resolves a link to its destination and records the qualified link action. */
export type LinktreeSelect = (linkId: string) => Promise<Readonly<{ url: string }>>

type SelectSecondaryLink = GuestResponseAction<
  { token: string; csrfNonce: string; linkId: string },
  { url: string }
>

/**
 * The selector a tile calls on a plain click, or undefined when the tile should
 * be a plain link to its click route.
 *
 * Only a guest who has rated holds a qualifying session: before that the server
 * action refuses (it answers 404 without saying why), so calling it would break
 * the tap. The Linktree is visible from arrival, so a tap before any rating is
 * navigation only and is never a qualified link action. The caller passes
 * `afterRating` from the branch of the page it is rendering.
 */
export function bindLinkSelector(
  input: Readonly<{
    afterRating: boolean
    token?: string
    csrfNonce?: string
    selectSecondaryLink?: SelectSecondaryLink
  }>,
): LinktreeSelect | undefined {
  const { afterRating, token, csrfNonce, selectSecondaryLink } = input
  if (!afterRating || !token || !csrfNonce || !selectSecondaryLink) return undefined
  return (linkId) => selectSecondaryLink({ data: { token, csrfNonce, linkId } })
}

/**
 * Records the qualified action, then goes to the destination it resolved. When
 * the action fails the guest still arrives, through the click route.
 */
export async function followLinktreeLink(
  input: Readonly<{
    linkId: string
    href: string
    select: LinktreeSelect
    navigate: (url: string) => void
  }>,
): Promise<void> {
  const { linkId, href, select, navigate } = input
  let url = href
  try {
    url = (await select(linkId)).url
  } catch {
    // The navigation has been approved already: losing the record must not lose the guest.
  }
  navigate(url)
}

/** A click the page may take over; a modified or non-primary click is the browser's own. */
export function isPlainPrimaryClick(
  event: Readonly<{
    button: number
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    defaultPrevented: boolean
  }>,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  )
}
