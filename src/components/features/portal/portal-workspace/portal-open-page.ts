// "Open page": the workspace header's way to the live guest page.
//
// The page's address is not kept in the clear. A manager gets it by revealing the
// live code's sealed address (ADR 0064), which the server rate-limits and records
// in History as a disclosure for the purpose "show". So the header offers that
// only when it can work: the portal is live, a code is live, and the keyring
// still holds the key that sealed it. In every other case it points to Share,
// where the address is shown or made.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import { directPortalAddress } from '../portal-share/portal-share-state'
import type { PortalPublicationState } from '../shared/types'

/** `hidden`: nothing useful to offer (no permission, or Share is already on screen). */
export type OpenPageMode = 'reveal' | 'share' | 'hidden'

export function deriveOpenPageMode(
  input: Readonly<{
    /** `portal.update`: what the reveal authorizes. */
    canUpdate: boolean
    /** The `portal.write` capability: the other half of what the reveal authorizes. */
    portalWriteEnabled: boolean
    publicationState: PortalPublicationState
    tokenStatus: PortalTokenStatus
    activeTab: PortalDetailTab
    /** The address is in memory (made or fetched again here), so no reveal is needed. */
    hasHeldAddress: boolean
  }>,
): OpenPageMode {
  const { publicationState, tokenStatus, hasHeldAddress } = input
  if (!(input.canUpdate && input.portalWriteEnabled)) return 'hidden'
  const live =
    publicationState === 'published' && (tokenStatus.hasActiveToken || hasHeldAddress)
  if (live && (tokenStatus.addressRecoverable || hasHeldAddress)) return 'reveal'
  // On Share itself a link to Share would do nothing.
  return input.activeTab === 'share' ? 'hidden' : 'share'
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
  /**
   * An address already held in memory (made or fetched again here). It opens
   * directly: nothing needs revealing, so nothing is disclosed or counted.
   */
  heldAddress?: string | null
  openAddress?: (url: string) => void
}): Promise<OpenPageOutcome> {
  const held =
    deps.heldAddress == null ? null : openablePageAddress({ publicUrl: deps.heldAddress })
  if (held !== null && deps.openAddress !== undefined) {
    deps.openAddress(held)
    return 'opened'
  }
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

const RATE_LIMITED_MESSAGE =
  'Too many requests to open the page. Please wait a little before trying again.'
const ADDRESS_UNAVAILABLE_MESSAGE =
  'The page could not be opened from here. Open it from the Share tab instead.'

/**
 * What a refused reveal says for "Open page". The server's own sentences are
 * written for "Download again" ("Too many downloads…", "This code cannot be
 * downloaded again…"), which is not what the manager clicked.
 */
export function openPageErrorMessage(error: unknown): string {
  if (isServerFunctionError(error)) {
    if (error.code === 'rate_limited') return RATE_LIMITED_MESSAGE
    if (error.code === 'address_unavailable') return ADDRESS_UNAVAILABLE_MESSAGE
  }
  return actionErrorMessage(error)
}
