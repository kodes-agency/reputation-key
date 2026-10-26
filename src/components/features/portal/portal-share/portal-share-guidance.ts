// What the Share tab says beyond the code itself: whom someone who can only
// look asks for the code (the workspace says why they can only look), whether
// guests can open the page the code leads to yet, and when the code before
// this one stops working. Pure, so each sentence is tested once.

import type { PortalPublicationState } from '../shared/types'
import { formatTimestamp, toInstant } from '#/lib/format'
import { describeTimezone } from '#/shared/timezone-display'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import { joinPeopleNames } from '../portal-review/portal-review-checks'

/**
 * Whom someone who can only look asks for the code or the print kit: the
 * portal's managers by name when they are known. Null when portal changes are
 * switched off, since nobody can hand either over then.
 */
export function describeWhoToAsk(
  canUpdate: boolean,
  managerNames: readonly string[],
): string | null {
  if (canUpdate) return null
  const names = joinPeopleNames(managerNames)
  return names === null
    ? 'Ask a manager of this portal for the QR code or print kit.'
    : `Ask ${names} for the QR code or print kit.`
}

export type UnpublishedCodeNotice = Readonly<{
  title: string
  body: string
  /** "Review & publish" is the way to open the page to guests. */
  offersReview: boolean
}>

const UNAVAILABLE = 'Guests who scan this code see “This page isn’t available right now”'

/**
 * A code works only while the portal is live: until then a scan opens the
 * unavailable page. Making the code, its QR image and its NFC address ahead of a
 * launch is fine, so this says so rather than stopping it, to someone who may
 * make the code (the print kit needs a live page, and says so itself); someone
 * who can only look is told the same fact without being sent to publish.
 * Null for a live portal.
 */
export function describeUnpublishedCode(
  state: PortalPublicationState,
  canManage: boolean,
): UnpublishedCodeNotice | null {
  switch (state) {
    case 'published':
      return null
    case 'draft':
      return {
        title: 'Not published yet',
        body: canManage
          ? `${UNAVAILABLE} until you publish the portal. You can still make the code, download its QR image and copy its NFC address ahead of the launch. The print kit waits until the portal is live.`
          : `${UNAVAILABLE} until the portal is published.`,
        offersReview: canManage,
      }
    case 'disabled':
      return {
        title: 'The portal is turned off',
        body: canManage
          ? `${UNAVAILABLE} until you publish the portal again. Printed codes work again then.`
          : `${UNAVAILABLE} until the portal is published again. Printed codes work again then.`,
        offersReview: canManage,
      }
    case 'archived':
      return {
        title: 'The portal is archived',
        body: canManage
          ? `${UNAVAILABLE}. Restore it before you share it.`
          : `${UNAVAILABLE}.`,
        offersReview: false,
      }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function untilPhrase(at: Date, now: Date): string | null {
  const days = Math.ceil((at.getTime() - now.getTime()) / DAY_MS)
  if (days <= 0) return null
  return days === 1 ? 'within a day' : `in ${days} days`
}

/**
 * When the code before this one stops: the moment in the property's time, as
 * History shows times ("Nov 7, 2026, 5:23 PM Sofia time, in 30 days"). Without
 * the property's zone the moment is given in UTC and says so. Null when there
 * is no cutoff.
 */
export function describeGraceCutoff(
  graceExpiresAt: string | null,
  now: Date,
  timeZone?: string,
): string | null {
  const at = toInstant(graceExpiresAt)
  if (at === null) return null
  const zone = timeZone ?? 'UTC'
  const moment = formatTimestamp(at, zone)
  if (moment === null) return null
  const city = describeTimezone(zone).city
  const zoneName = city === 'UTC' ? 'UTC' : `${city} time`
  const until = untilPhrase(at, now)
  return until === null ? `${moment} ${zoneName}` : `${moment} ${zoneName}, ${until}`
}

/** Under "Copy NFC address": what the address is for and how to check a tag. */
export const NFC_ADDRESS_HINT =
  'Write this address to an NFC tag with any tag-writing app, then tap the tag with a phone to test it. Use this address, not the public one, so taps are counted as NFC.'

/**
 * The same, for the short print address (ADR 0069): 48 bytes on a tag, so the
 * cheapest NTAG213 holds it. The long address is 159 bytes on the beta, which an
 * NTAG213 (144) does not, so its hint says nothing about the tag.
 */
export const NFC_SHORT_ADDRESS_HINT =
  'Write this address to an NFC tag (an NTAG213 or any larger one will do) with any tag-writing app, then tap the tag with a phone to test it. Use this address, not the public one, so taps are counted as NFC.'

/** The hint for the NFC address the manager holds, or the general one while it is not in memory. */
export const nfcAddressHint = (nfcAddress: string | null): string =>
  nfcAddress !== null && printAddressShape(nfcAddress) === 'short'
    ? NFC_SHORT_ADDRESS_HINT
    : NFC_ADDRESS_HINT
