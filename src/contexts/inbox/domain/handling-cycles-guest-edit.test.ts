import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import { createNextHandlingCycle } from './handling-cycles'
import type { HandlingCycleHead } from './types'

// A guest edit is a new Material Review Revision. What it does to the Inbox
// depends on the work it lands on: an OPEN cycle was never handled, so the edit
// supersedes it and opens the next one; a CLOSED cycle was answered, and a
// reply written for the old revision does not answer the new one, so the edit
// REOPENS the item (ADR 0046: `inbox.handling_cycle.reopened` → urgent
// `inbox.reopened`).

const ITEM_ID = inboxItemId('4e100000-0000-0000-0000-000000000001')
const ORG_ID = organizationId('org-inbox-cycle-guest-edit')
const PROPERTY_ID = propertyId('4e100000-0000-0000-0000-000000000002')
const REVIEW_ID = reviewId('4e100000-0000-0000-0000-000000000003')
const OPENED_AT = new Date('2026-09-28T08:00:00.000Z')

const reviewHead = (overrides: Partial<HandlingCycleHead> = {}): HandlingCycleHead => ({
  inboxItemId: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType: 'review',
  sourceId: REVIEW_ID,
  currentCycleNumber: 1,
  currentSourceRevision: 1,
  stateRevision: 2,
  status: 'closed',
  ...overrides,
})

const guestEdit = (current: HandlingCycleHead) =>
  createNextHandlingCycle({
    current,
    sourceRevision: current.currentSourceRevision + 1,
    openedReason: 'material_revision_changed',
    openedBy: null,
    actorType: 'provider',
    triggerEventId: null,
    openedAt: OPENED_AT,
  })

describe('a guest edit of a Google review', () => {
  it('reopens an answered (closed) review as a revision reopen', () => {
    const result = guestEdit(reviewHead())

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.cycle).toMatchObject({
      cycleNumber: 2,
      sourceRevision: 2,
      openedReason: 'material_revision_changed',
      supersedesCycleNumber: 1,
    })
    expect(result.value.head).toMatchObject({
      currentCycleNumber: 2,
      currentSourceRevision: 2,
      stateRevision: 3,
      status: 'open',
    })
    expect(result.value.transitions).toEqual([
      expect.objectContaining({
        cycleNumber: 2,
        stateRevision: 3,
        sourceRevision: 2,
        kind: 'reopened',
        transitionReason: 'material_revision_changed',
        actorType: 'provider',
        actorUserId: null,
      }),
    ])
  })

  it('still supersedes an unanswered (open) review and opens the next cycle', () => {
    const result = guestEdit(reviewHead({ status: 'open', stateRevision: 1 }))

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.transitions).toEqual([
      expect.objectContaining({
        cycleNumber: 1,
        kind: 'closed',
        transitionReason: 'superseded_by_source_revision',
      }),
      expect.objectContaining({
        cycleNumber: 2,
        kind: 'opened',
        transitionReason: 'material_revision_changed',
      }),
    ])
  })

  it('leaves a new private-feedback occurrence on closed work as an opening', () => {
    const result = createNextHandlingCycle({
      current: reviewHead({
        sourceType: 'feedback',
        sourceId: feedbackId('4e100000-0000-0000-0000-000000000004'),
      }),
      sourceRevision: 2,
      openedReason: 'feedback_submitted',
      openedBy: null,
      actorType: 'guest',
      triggerEventId: null,
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.transitions.map((transition) => transition.kind)).toEqual([
      'opened',
    ])
  })
})
