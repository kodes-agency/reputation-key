// "Open page": the workspace header's way to the live guest page.
//
// The page's address is not kept in the clear. A manager gets it by revealing the
// live code's sealed address (ADR 0064), which the server rate-limits and records
// in History as a disclosure for the purpose "show". So the header offers that
// only when it can work: the portal is live, a code is live, and the keyring
// still holds the key that sealed it. In every other case it points to Share,
// where the address is shown or made.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import { directPortalAddress } from '../portal-share/portal-share-state'
import type { PortalPublicationState } from '../shared/types'

export type OpenPageMode = 'reveal' | 'share'

export function deriveOpenPageMode(
  input: Readonly<{
    /** `portal.update` and the `portal.write` capability: what the reveal needs. */
    canReveal: boolean
    publicationState: PortalPublicationState
    tokenStatus: PortalTokenStatus
  }>,
): OpenPageMode {
  const { canReveal, publicationState, tokenStatus } = input
  const live = publicationState === 'published' && tokenStatus.hasActiveToken
  return canReveal && live && tokenStatus.addressRecoverable ? 'reveal' : 'share'
}

/**
 * The address to open for a revealed link, or null when it is not a page of this
 * product. The QR marker is dropped: a visit carrying it is recorded as a scan
 * from a printed code, and a manager checking their own page is not one.
 */
export function openablePageAddress(
  link: Readonly<{ publicUrl: string }>,
): string | null {
  const address = directPortalAddress(link.publicUrl)
  try {
    const url = new URL(address)
    const isWeb = url.protocol === 'https:' || url.protocol === 'http:'
    return isWeb && url.pathname.startsWith('/p/') ? url.toString() : null
  } catch {
    return null
  }
}

/** A tab opened before the address is known, so the click still counts as the user's. */
export type BlankTab = Readonly<{ navigate: (url: string) => void; close: () => void }>

export type OpenPageOutcome = 'opened' | 'popup_blocked' | 'unavailable' | 'failed'

/**
 * Browsers only let a click open a tab, and the address arrives after a round
 * trip. So the tab opens first and is sent to the page when the address comes.
 * With no tab there is no reveal: nothing is disclosed that cannot be shown.
 * A refused reveal reports through the mutation itself; this only cleans up.
 */
export async function openLivePage(deps: {
  openBlankTab: () => BlankTab | null
  reveal: (purpose: 'show') => Promise<Readonly<{ publicUrl: string }>>
}): Promise<OpenPageOutcome> {
  const tab = deps.openBlankTab()
  if (tab === null) return 'popup_blocked'
  let address: string | null
  try {
    address = openablePageAddress(await deps.reveal('show'))
  } catch {
    tab.close()
    return 'failed'
  }
  if (address === null) {
    tab.close()
    return 'unavailable'
  }
  tab.navigate(address)
  return 'opened'
}
