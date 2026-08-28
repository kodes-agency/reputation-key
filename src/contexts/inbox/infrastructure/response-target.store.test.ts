import { describe, expect, it } from 'vitest'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'
import type { HandlingCycle } from '../domain/types'
import { isInboxError } from '../domain/errors'
import { resolveReviewCycleTargetProvenance } from './response-target.store'

const OPENED_AT = new Date('2026-08-28T10:00:00.000Z')
const SOURCE_AT = new Date('2026-01-03T10:00:00.000Z')

const cycle = (openedReason: HandlingCycle['openedReason']): HandlingCycle => ({
  inboxItemId: inboxItemId('11111111-1111-4111-8111-111111111111'),
  cycleNumber: openedReason === 'review_observed' ? 1 : 2,
  organizationId: organizationId('org-response-target-provenance'),
  propertyId: propertyId('22222222-2222-4222-8222-222222222222'),
  sourceType: 'review',
  sourceId: reviewId('33333333-3333-4333-8333-333333333333'),
  sourceRevision: 1,
  openedReason,
  manualReopenReason: openedReason === 'manual_reopen' ? 'new_information' : null,
  manualReopenExplanation: null,
  supersedesCycleNumber: openedReason === 'review_observed' ? null : 1,
  openedBy: openedReason === 'manual_reopen' ? userId('manager-1') : null,
  openedAt: OPENED_AT,
})

const anchor = (
  eligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown',
  targetStart: ReviewCycleTargetAnchor['targetStart'],
): ReviewCycleTargetAnchor => ({
  reviewAuthority: {
    authority: 'review.current-response-target.v1',
    organizationId: 'org-response-target-provenance',
    propertyId: '22222222-2222-4222-8222-222222222222',
    reviewId: '33333333-3333-4333-8333-333333333333',
    sourceEpoch: 2,
    materialReviewRevision: 1,
    eligibility,
    responseTargetStartAt: eligibility === 'measured' ? SOURCE_AT : null,
  },
  targetStart,
})

describe('Review cycle target provenance', () => {
  it('keeps an imported initial Review cycle excluded without inventing a clock', () => {
    expect(
      resolveReviewCycleTargetProvenance(
        cycle('review_observed'),
        anchor('historical_onboarding', { basis: 'review_provenance' }),
      ),
    ).toEqual({ eligibility: 'historical_onboarding', startAt: null })
  })

  it.each(['historical_onboarding', 'legacy_unknown'] as const)(
    'measures a live manual reopen from its operational instant despite %s source provenance',
    (eligibility) => {
      expect(
        resolveReviewCycleTargetProvenance(
          cycle('manual_reopen'),
          anchor(eligibility, { basis: 'operational_reopen', at: OPENED_AT }),
        ),
      ).toEqual({ eligibility: 'measured', startAt: OPENED_AT })
    },
  )

  it('keeps a material revision target on Review-owned provider provenance', () => {
    expect(
      resolveReviewCycleTargetProvenance(
        cycle('material_revision_changed'),
        anchor('measured', { basis: 'review_provenance' }),
      ),
    ).toEqual({ eligibility: 'measured', startAt: SOURCE_AT })
  })

  it('rejects historical projection authority outside source-event cycles', () => {
    const current = anchor('measured', { basis: 'review_provenance' })
    const historical: ReviewCycleTargetAnchor = {
      ...current,
      reviewAuthority: {
        ...current.reviewAuthority,
        authority: 'review.inbox-projection-revision.v1',
        observedAt: SOURCE_AT,
      },
    }

    expect(() =>
      resolveReviewCycleTargetProvenance(cycle('manual_reopen'), historical),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })

  it('rejects an operational clock on a non-operational cycle or a different instant', () => {
    expect(() =>
      resolveReviewCycleTargetProvenance(
        cycle('material_revision_changed'),
        anchor('measured', { basis: 'operational_reopen', at: OPENED_AT }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }))

    expect(() =>
      resolveReviewCycleTargetProvenance(
        cycle('manual_reopen'),
        anchor('measured', {
          basis: 'operational_reopen',
          at: new Date(OPENED_AT.getTime() + 1),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })

  it('raises a governed Inbox error for a forged Review scope', () => {
    const forged = anchor('measured', { basis: 'review_provenance' })
    expect(() =>
      resolveReviewCycleTargetProvenance(cycle('review_observed'), {
        ...forged,
        reviewAuthority: { ...forged.reviewAuthority, reviewId: 'other-review' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
    try {
      resolveReviewCycleTargetProvenance(cycle('review_observed'), {
        ...forged,
        reviewAuthority: { ...forged.reviewAuthority, reviewId: 'other-review' },
      })
    } catch (error) {
      expect(isInboxError(error)).toBe(true)
    }
  })
})
