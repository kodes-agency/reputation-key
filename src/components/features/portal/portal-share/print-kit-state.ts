// Availability and wording shared by the Share tab's print controls.
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import type { PortalPublicationState } from '../shared/types'

/**
 * Whether the portal has a live version to print from. A print carries the live
 * page's code, and the live version closes when a portal leaves "published": a
 * draft never had one, and turning it off or archiving it ends it. So the state
 * answers it. A tab that was not told the state reads as live and lets the read
 * decide (see `isNothingLiveRefusal`).
 */
export function printKitHasLiveVersion(
  state: PortalPublicationState | undefined,
): boolean {
  return state === undefined || state === 'published'
}

/** What the server calls a read or a download for a portal with nothing live. */
const NOTHING_LIVE_CODE = 'publication_snapshot_unavailable'

/** The read was refused because nothing is live: asking again cannot change that. */
export function isNothingLiveRefusal(error: unknown): boolean {
  return isServerFunctionError(error) && error.code === NOTHING_LIVE_CODE
}

export type PrintKitNotLiveNotice = Readonly<{
  body: string
  /** Where "Review & publish" goes; null when it is not offered. */
  review: Readonly<{ propertyId: string; portalId: string }> | null
}>

const PRINT_CARRIES_LIVE_CODE = 'A print carries the code of the live page.'

/**
 * What the Print kit section says in place of itself while nothing is live: what
 * to do first, and why. An archived portal is restored from the Portals list
 * before it can be published, so it is not sent to the review. A portal the
 * state calls live but the server says has nothing live gets the draft's words.
 * The review link needs the portal's property: without it the tab offers none.
 */
export function describePrintKitNotLive(
  state: PortalPublicationState | undefined,
  portal: Readonly<{ portalId: string; propertyId?: string }>,
): PrintKitNotLiveNotice {
  const review =
    portal.propertyId === undefined
      ? null
      : { propertyId: portal.propertyId, portalId: portal.portalId }
  switch (state) {
    case 'disabled':
      return {
        body: `Publish this portal again to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review,
      }
    case 'archived':
      return {
        body: `Restore this portal and publish it to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review: null,
      }
    default:
      return {
        body: `Publish this portal to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review,
      }
  }
}

/**
 * The download needs the code's address, which only a sealed code can hand
 * over again (ADR 0064). A code made without one says how to get one.
 */
export function printKitAvailability(
  input: Readonly<{ canDownloadAgain: boolean }>,
): Readonly<{ ready: boolean; reason: string | null }> {
  return input.canDownloadAgain
    ? { ready: true, reason: null }
    : {
        ready: false,
        reason:
          'The print kit needs the code’s address, and this code did not keep it. Replace the code to make one that can be downloaded again.',
      }
}
