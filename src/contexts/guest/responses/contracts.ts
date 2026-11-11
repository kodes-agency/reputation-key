import type { GuestResponse } from '../domain/guest-response'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import { assertNever } from '#/shared/domain/assert'

export type ResolvePrimaryStaffAttribution = (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    observedAt: Date
  }>,
) => Promise<PrimaryStaffAttributionSnapshot | null>

export type GuestResponseView = Readonly<{
  /** Admission was exhausted; this receipt has no stored response to mutate. */
  dropped?: true
  status: GuestResponse['status']
  rating: number | null
  hasPrivateFeedback: boolean
  privateFeedbackEligible: boolean
  submittedAt: string | null
  correctedAt: string | null
  correctionDeadline: string | null
  correctionAvailable: boolean
  responseWithdrawalDeadline: string | null
  responseWithdrawalAvailable: boolean
  feedbackSubmittedAt: string | null
  feedbackWithdrawalDeadline: string | null
  feedbackWithdrawalAvailable: boolean
  feedbackWithdrawnAt: string | null
  deletedAt: string | null
}>

/**
 * Whether the session's response admits a qualified follow-up action (a fresh
 * response on a shared device, a Google Review selection): it holds a durable
 * private rating and was not withdrawn. A Linktree tap needs no rating (ADR 0044,
 * amendment 2026-11-01). The switch is exhaustive, so a new status must decide here.
 */
export function isQualifiedGuestResponse(view: GuestResponseView | null): boolean {
  if (view === null || view.dropped) return false
  switch (view.status) {
    case 'deleted':
      return false
    case 'pending':
    case 'submitted':
    case 'corrected':
    case 'moderated':
    case 'expired':
      return view.rating !== null
    default:
      return assertNever('isQualifiedGuestResponse', view.status)
  }
}

/**
 * Whether the session's response admits "start over" on this device: it holds a
 * durable private rating (the shared-device case), the guest withdrew it, or
 * admission returned an unstored receipt.
 *
 * A withdrawn response is the one a session can never replace: a session takes
 * one response (`submitResponse` refuses a deleted one), so without a fresh
 * session the page is a dead end for the next guest, and for the same guest if
 * they only meant to re-rate. A fresh session costs nothing a rating-holding
 * session does not already: it is rate limited and network-pressure counted on
 * the same keys, and what was withdrawn is gone (its facts were retracted), so
 * the cycle can add no reading. Every other response, including none, stays
 * refused: with nothing to end there is nothing to start over from.
 */
export function canStartNewGuestResponse(view: GuestResponseView | null): boolean {
  return (
    view?.dropped === true || isQualifiedGuestResponse(view) || view?.status === 'deleted'
  )
}
