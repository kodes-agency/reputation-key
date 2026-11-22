import { describe, expect, it } from 'vitest'
import type { GuestResponseStatus } from '../domain/guest-response'
import {
  canStartNewGuestResponse,
  isQualifiedGuestResponse,
  type GuestResponseView,
} from './contracts'

const view = (status: GuestResponseStatus, rating: number | null): GuestResponseView => ({
  status,
  rating,
  hasPrivateFeedback: false,
  privateFeedbackEligible: false,
  submittedAt: null,
  correctedAt: null,
  correctionDeadline: null,
  correctionAvailable: false,
  responseWithdrawalDeadline: null,
  responseWithdrawalAvailable: false,
  feedbackSubmittedAt: null,
  feedbackWithdrawalDeadline: null,
  feedbackWithdrawalAvailable: false,
  feedbackWithdrawnAt: null,
  deletedAt: status === 'deleted' ? '2026-01-01T12:10:00.000Z' : null,
})

describe('isQualifiedGuestResponse', () => {
  // Keyed by every status, so a new status fails typecheck until it decides.
  const RATED_RESPONSE_QUALIFIES: Record<GuestResponseStatus, boolean> = {
    pending: true,
    submitted: true,
    corrected: true,
    moderated: true,
    expired: true,
    deleted: false,
  }
  const STATUSES = Object.keys(RATED_RESPONSE_QUALIFIES) as GuestResponseStatus[]

  it('denies a session that has no response', () => {
    expect(isQualifiedGuestResponse(null)).toBe(false)
  })

  it.each(STATUSES)('qualifies a rated %s response unless it was withdrawn', (status) => {
    expect(isQualifiedGuestResponse(view(status, 1))).toBe(
      RATED_RESPONSE_QUALIFIES[status],
    )
    expect(isQualifiedGuestResponse(view(status, 5))).toBe(
      RATED_RESPONSE_QUALIFIES[status],
    )
  })

  it.each(STATUSES)('denies an unrated %s response', (status) => {
    expect(isQualifiedGuestResponse(view(status, null))).toBe(false)
  })
})

describe('canStartNewGuestResponse', () => {
  it('denies a session that has no response: there is nothing to start over from', () => {
    expect(canStartNewGuestResponse(null)).toBe(false)
  })

  it.each(['pending', 'submitted', 'corrected', 'moderated', 'expired'] as const)(
    'admits a rated %s response, as the shared-device case always did',
    (status) => {
      expect(canStartNewGuestResponse(view(status, 4))).toBe(true)
    },
  )

  it.each(['pending', 'submitted', 'corrected', 'moderated', 'expired'] as const)(
    'still denies an unrated %s response',
    (status) => {
      expect(canStartNewGuestResponse(view(status, null))).toBe(false)
    },
  )

  it('admits a response the guest withdrew, rated or not: its session can take no other', () => {
    expect(canStartNewGuestResponse(view('deleted', null))).toBe(true)
    expect(canStartNewGuestResponse(view('deleted', 2))).toBe(true)
  })

  it('widens nothing else: a withdrawn response still qualifies for no Google or link action', () => {
    expect(isQualifiedGuestResponse(view('deleted', null))).toBe(false)
    expect(isQualifiedGuestResponse(view('deleted', 2))).toBe(false)
  })
})
