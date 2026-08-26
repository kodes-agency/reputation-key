import { describe, expect, it } from 'vitest'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  createInitialReviewHandlingCycle,
  createNextReviewHandlingCycle,
} from './handling-cycles'

const ITEM_ID = inboxItemId('4e000000-0000-0000-0000-000000000001')
const ORG_ID = organizationId('org-inbox-cycle-domain')
const PROPERTY_ID = propertyId('4e000000-0000-0000-0000-000000000002')
const REVIEW_ID = reviewId('4e000000-0000-0000-0000-000000000003')
const USER_ID = userId('user-inbox-cycle-domain')
const OPENED_AT = new Date('2026-08-26T08:00:00.000Z')

describe('Review Handling Cycle decisions', () => {
  it('starts cycle one at the observed Material Review Revision', () => {
    const result = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 4,
      openedAt: OPENED_AT,
      status: 'open',
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toEqual({
      cycle: {
        inboxItemId: ITEM_ID,
        cycleNumber: 1,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        materialReviewRevision: 4,
        openedReason: 'review_observed',
        supersedesCycleNumber: null,
        openedBy: null,
        openedAt: OPENED_AT,
      },
      head: {
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        currentCycleNumber: 1,
        currentMaterialReviewRevision: 4,
        stateRevision: 1,
        status: 'open',
      },
    })
  })

  it('appends a new cycle for a later material revision without changing the prior head', () => {
    const current = {
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      currentCycleNumber: 2,
      currentMaterialReviewRevision: 4,
      stateRevision: 7,
      status: 'closed' as const,
    }

    const result = createNextReviewHandlingCycle({
      current,
      materialReviewRevision: 5,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.cycle).toMatchObject({
      cycleNumber: 3,
      materialReviewRevision: 5,
      supersedesCycleNumber: 2,
      openedReason: 'material_revision_changed',
    })
    expect(result.value.head).toMatchObject({
      currentCycleNumber: 3,
      currentMaterialReviewRevision: 5,
      stateRevision: 8,
      status: 'open',
    })
    expect(current).toMatchObject({
      currentCycleNumber: 2,
      currentMaterialReviewRevision: 4,
      stateRevision: 7,
      status: 'closed',
    })
  })

  it('allows a manual reopen to create another cycle on the same material revision', () => {
    const initial = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 4,
      openedAt: OPENED_AT,
      status: 'open',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const reopened = createNextReviewHandlingCycle({
      current: initial.value.head,
      materialReviewRevision: 4,
      openedReason: 'manual_reopen',
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })

    expect(reopened.isOk()).toBe(true)
    if (reopened.isErr()) return
    expect(reopened.value.cycle).toMatchObject({
      cycleNumber: 2,
      materialReviewRevision: 4,
      openedBy: USER_ID,
      supersedesCycleNumber: 1,
    })
  })

  it('rejects a material-change cycle that does not advance the material revision', () => {
    const initial = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 4,
      openedAt: OPENED_AT,
      status: 'open',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const result = createNextReviewHandlingCycle({
      current: initial.value.head,
      materialReviewRevision: 4,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
    })
  })
})
