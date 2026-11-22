import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { Result } from '#/shared/domain'
import {
  closeHandlingCycle,
  createInitialHandlingCycle,
  createNextHandlingCycle,
} from './handling-cycles'

const ITEM_ID = inboxItemId('4e000000-0000-0000-0000-000000000001')
const ORG_ID = organizationId('org-inbox-cycle-domain')
const PROPERTY_ID = propertyId('4e000000-0000-0000-0000-000000000002')
const REVIEW_ID = reviewId('4e000000-0000-0000-0000-000000000003')
const USER_ID = userId('user-inbox-cycle-domain')
const OPENED_AT = new Date('2026-08-26T08:00:00.000Z')
const FEEDBACK_ID = feedbackId('4e000000-0000-0000-0000-000000000004')

const initialReviewCycle = (
  overrides: Partial<Parameters<typeof createInitialHandlingCycle>[0]> = {},
) =>
  createInitialHandlingCycle({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    sourceRevision: 4,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
    openedAt: OPENED_AT,
    status: 'open',
    ...overrides,
  })

const nextReviewCycle = (
  current: Parameters<typeof createNextHandlingCycle>[0]['current'],
  input: Omit<
    Parameters<typeof createNextHandlingCycle>[0],
    'current' | 'actorType' | 'triggerEventId'
  >,
) =>
  createNextHandlingCycle({
    ...input,
    current,
    actorType: input.openedBy ? 'user' : 'provider',
    triggerEventId: null,
  })

type CycleHead = Parameters<typeof createNextHandlingCycle>[0]['current']
type NextInput = Parameters<typeof createNextHandlingCycle>[0]
type CloseInput = Parameters<typeof closeHandlingCycle>[0]

const okOf = <T, E>(result: Result<T, E>): T => {
  expect(result.isOk()).toBe(true)
  if (result.isErr()) throw new Error('expected an ok result')
  return result.value
}

const errorOf = <T, E>(result: Result<T, E>): E => {
  expect(result.isErr()).toBe(true)
  if (result.isOk()) throw new Error('expected an error result')
  return result.error
}

const reviewCycleHead = (overrides: Partial<CycleHead> = {}): CycleHead => ({
  inboxItemId: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType: 'review',
  sourceId: REVIEW_ID,
  currentCycleNumber: 1,
  currentSourceRevision: 1,
  stateRevision: 1,
  status: 'closed',
  ...overrides,
})

const feedbackCycleHead = (overrides: Partial<CycleHead> = {}): CycleHead => ({
  ...reviewCycleHead(),
  sourceType: 'feedback',
  sourceId: FEEDBACK_ID,
  ...overrides,
})

const feedbackInitial = (
  overrides: Partial<Parameters<typeof createInitialHandlingCycle>[0]> = {},
) =>
  createInitialHandlingCycle({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    sourceType: 'feedback',
    sourceId: FEEDBACK_ID,
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
    actorType: 'guest',
    triggerEventId: 'guest-feedback-event-1',
    openedAt: OPENED_AT,
    status: 'open',
    ...overrides,
  })

const nextCycle = (current: CycleHead, overrides: Partial<NextInput> = {}) =>
  createNextHandlingCycle({
    current,
    sourceRevision: 2,
    openedReason: 'material_revision_changed',
    openedBy: null,
    actorType: 'provider',
    triggerEventId: null,
    openedAt: OPENED_AT,
    ...overrides,
  })

const manualReopen = (overrides: Partial<NextInput> = {}) =>
  nextCycle(reviewCycleHead(), {
    sourceRevision: 1,
    openedReason: 'manual_reopen',
    openedBy: USER_ID,
    actorType: 'user',
    ...overrides,
  })

const closeCycle = (current: CycleHead, overrides: Partial<CloseInput> = {}) =>
  closeHandlingCycle({
    current,
    closeReason: 'confirmed_on_google',
    actorType: 'provider',
    actorUserId: null,
    triggerEventId: 'reply-confirmed',
    closedAt: OPENED_AT,
    ...overrides,
  })

describe('Review Handling Cycle decisions', () => {
  it('starts cycle one at the observed Material Review Revision', () => {
    const result = initialReviewCycle({ sourceRevision: 4, status: 'open' })

    expect(okOf(result)).toEqual({
      cycle: {
        inboxItemId: ITEM_ID,
        cycleNumber: 1,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        sourceType: 'review',
        sourceId: REVIEW_ID,
        sourceRevision: 4,
        openedReason: 'review_observed',
        manualReopenReason: null,
        manualReopenExplanation: null,
        supersedesCycleNumber: null,
        openedBy: null,
        openedAt: OPENED_AT,
      },
      head: {
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        sourceType: 'review',
        sourceId: REVIEW_ID,
        currentCycleNumber: 1,
        currentSourceRevision: 4,
        stateRevision: 1,
        status: 'open',
      },
      transitions: [
        {
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 1,
          organizationId: ORG_ID,
          propertyId: PROPERTY_ID,
          sourceType: 'review',
          sourceId: REVIEW_ID,
          sourceRevision: 4,
          kind: 'opened',
          transitionReason: 'review_observed',
          actorType: 'provider',
          actorUserId: null,
          triggerEventId: null,
          transitionedAt: OPENED_AT,
        },
      ],
    })
  })

  it('appends a new cycle for a later material revision without changing the prior head', () => {
    const current = reviewCycleHead({
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
    })

    const result = nextCycle(current, {
      sourceRevision: 5,
      triggerEventId: '4e000000-0000-0000-0000-000000000090',
    })

    const value = okOf(result)
    expect(value.cycle).toMatchObject({
      cycleNumber: 3,
      sourceRevision: 5,
      supersedesCycleNumber: 2,
      openedReason: 'material_revision_changed',
    })
    expect(value.head).toMatchObject({
      currentCycleNumber: 3,
      currentSourceRevision: 5,
      stateRevision: 8,
      status: 'open',
    })
    expect(current).toMatchObject({
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'closed',
    })
  })

  it('starts a private-feedback cycle at the exact Guest Response Revision', () => {
    const result = feedbackInitial({
      sourceRevision: 2,
      triggerEventId: 'guest-feedback-event-2',
    })

    expect(okOf(result)).toMatchObject({
      cycle: {
        sourceType: 'feedback',
        sourceId: FEEDBACK_ID,
        sourceRevision: 2,
        openedReason: 'feedback_submitted',
      },
      head: {
        sourceType: 'feedback',
        sourceId: FEEDBACK_ID,
        currentSourceRevision: 2,
      },
      transitions: [
        {
          kind: 'opened',
          actorType: 'guest',
          triggerEventId: 'guest-feedback-event-2',
        },
      ],
    })
  })

  it('closes the current source cycle without changing its immutable opening', () => {
    const initial = okOf(feedbackInitial())

    const closed = okOf(
      closeCycle(initial.head, {
        closeReason: 'guest_withdrawn',
        actorType: 'guest',
        triggerEventId: 'guest-feedback-retracted-1',
        closedAt: new Date('2026-08-26T09:00:00.000Z'),
      }),
    )

    expect(closed.head).toMatchObject({ status: 'closed', stateRevision: 2 })
    expect(closed.transition).toMatchObject({
      cycleNumber: 1,
      sourceRevision: 1,
      kind: 'closed',
      transitionReason: 'guest_withdrawn',
      actorType: 'guest',
      actorUserId: null,
      triggerEventId: 'guest-feedback-retracted-1',
    })
    expect(initial.cycle).toMatchObject({
      cycleNumber: 1,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
    })
  })

  it('never turns a rating-only Guest correction into a new feedback cycle', () => {
    const initial = okOf(feedbackInitial())

    const attempted = nextCycle(initial.head, {
      actorType: 'guest',
      triggerEventId: 'guest-rating-corrected-1',
    })

    expect(attempted.isErr()).toBe(true)
  })

  it('allows a manual reopen to create another cycle on the same material revision', () => {
    const initial = okOf(initialReviewCycle({ sourceRevision: 4, status: 'closed' }))

    const reopened = nextReviewCycle(initial.head, {
      sourceRevision: 4,
      openedReason: 'manual_reopen',
      manualReopenReason: 'guest_follow_up_still_needed',
      manualReopenExplanation: null,
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })

    expect(okOf(reopened).cycle).toMatchObject({
      cycleNumber: 2,
      sourceRevision: 4,
      openedBy: USER_ID,
      manualReopenReason: 'guest_follow_up_still_needed',
      manualReopenExplanation: null,
      supersedesCycleNumber: 1,
    })
  })

  it('requires and trims an explanation only for the Other reopen reason', () => {
    const initial = okOf(initialReviewCycle({ sourceRevision: 4, status: 'closed' }))
    const reopen = (manualReopenExplanation: string) =>
      nextReviewCycle(initial.head, {
        sourceRevision: 4,
        openedReason: 'manual_reopen',
        manualReopenReason: 'other',
        manualReopenExplanation,
        openedBy: USER_ID,
        openedAt: OPENED_AT,
      })

    expect(reopen('   ').isErr()).toBe(true)

    const reopened = okOf(reopen('  A new guest message needs a response.  '))
    expect(reopened.cycle).toMatchObject({
      manualReopenReason: 'other',
      manualReopenExplanation: 'A new guest message needs a response.',
    })
  })

  it('rejects a material-change cycle that does not advance the material revision', () => {
    const initial = okOf(initialReviewCycle({ sourceRevision: 4, status: 'open' }))

    const result = nextReviewCycle(initial.head, {
      sourceRevision: 4,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OPENED_AT,
    })

    expect(errorOf(result)).toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
    })
  })
})

describe('source-neutral Handling Cycle invariants', () => {
  it('rejects a non-positive revision for a Review source', () => {
    const result = initialReviewCycle({ sourceRevision: 0, status: 'open' })

    expect(errorOf(result)).toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
      message: 'Handling Cycle source revision must be positive',
      context: { sourceRevision: 0 },
    })
  })

  it.each([
    {
      sourceType: 'review' as const,
      sourceId: REVIEW_ID,
      openedReason: 'feedback_submitted' as const,
    },
    {
      sourceType: 'feedback' as const,
      sourceId: FEEDBACK_ID,
      openedReason: 'review_observed' as const,
    },
  ])(
    'rejects $openedReason as an opening reason for a $sourceType source',
    ({ sourceType, sourceId, openedReason }) => {
      const result = createInitialHandlingCycle({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        sourceType,
        sourceId,
        sourceRevision: 1,
        openedReason,
        actorType: 'system',
        triggerEventId: null,
        openedAt: OPENED_AT,
        status: 'open',
      })

      expect(errorOf(result)).toMatchObject({
        _tag: 'InboxError',
        code: 'invalid_input',
        message: 'Handling Cycle opening reason does not match source',
      })
    },
  )

  it.each([
    ['cycle number', { currentCycleNumber: 0 }, 2],
    ['current source revision', { currentSourceRevision: 0 }, 2],
    ['state revision', { stateRevision: 0 }, 2],
    ['requested source revision', {}, 0],
  ] as const)(
    'rejects an invalid %s before opening a next cycle',
    (_, overrides, revision) => {
      const result = nextCycle(reviewCycleHead(overrides), {
        sourceRevision: revision,
        triggerEventId: 'review-changed-2',
      })

      expect(errorOf(result)).toMatchObject({
        _tag: 'InboxError',
        code: 'invalid_input',
        message: 'Handling Cycle revisions must be positive',
      })
    },
  )

  it.each([
    {
      label: 'the current cycle is still open',
      current: reviewCycleHead({ status: 'open' }),
      openedBy: USER_ID,
      actorType: 'user' as const,
      manualReopenReason: 'guest_follow_up_still_needed' as const,
      message: 'Only a closed Handling Cycle can be reopened',
    },
    {
      label: 'no user is identified',
      current: reviewCycleHead(),
      openedBy: null,
      actorType: 'user' as const,
      manualReopenReason: 'guest_follow_up_still_needed' as const,
      message: 'A manual reopen requires an actor',
    },
    {
      label: 'the identified actor is not a user',
      current: reviewCycleHead(),
      openedBy: USER_ID,
      actorType: 'system' as const,
      manualReopenReason: 'guest_follow_up_still_needed' as const,
      message: 'A manual reopen requires a user actor',
    },
    {
      label: 'the manager omits the reason',
      current: reviewCycleHead(),
      openedBy: USER_ID,
      actorType: 'user' as const,
      manualReopenReason: undefined,
      message: 'A manual reopen reason is required',
    },
  ])('rejects a manual reopen when $label', ({ current, message, ...input }) => {
    const result = nextCycle(current, {
      sourceRevision: 1,
      openedReason: 'manual_reopen',
      ...input,
    })

    expect(errorOf(result)).toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
      message,
    })
  })

  it('requires an explanation when a manager chooses Other', () => {
    const result = manualReopen({ manualReopenReason: 'other' })

    expect(errorOf(result).message).toBe(
      'Other manual reopen reason requires a short explanation',
    )
  })

  it('rejects an explanation when a manager chooses a named reason', () => {
    const result = manualReopen({
      manualReopenReason: 'new_information',
      manualReopenExplanation: 'This text belongs only with Other.',
    })

    expect(errorOf(result).message).toBe(
      'A manual reopen explanation is only valid for Other',
    )
  })

  it.each([
    { manualReopenReason: 'new_information' as const },
    { manualReopenExplanation: 'Manager-only context' },
  ])('rejects manager reopen context on a system-opened cycle', (reopenContext) => {
    const result = nextCycle(reviewCycleHead(), {
      ...reopenContext,
      triggerEventId: 'review-changed-2',
    })

    expect(errorOf(result).message).toBe(
      'System-opened cycles cannot carry a reopen reason',
    )
  })

  it.each([
    {
      label: 'a Review source',
      current: reviewCycleHead(),
      sourceRevision: 2,
    },
    {
      label: 'an unchanged Feedback revision',
      current: feedbackCycleHead(),
      sourceRevision: 1,
    },
  ])('rejects feedback_submitted for $label', ({ current, sourceRevision }) => {
    const result = nextCycle(current, {
      sourceRevision,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: 'feedback-submitted-2',
    })

    expect(errorOf(result).message).toBe(
      'A new private-feedback occurrence must advance the Guest revision',
    )
  })

  it('opens the next Feedback handling episode when private feedback advances', () => {
    const result = nextCycle(feedbackCycleHead(), {
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: 'feedback-submitted-2',
    })

    expect(okOf(result)).toMatchObject({
      cycle: {
        cycleNumber: 2,
        sourceType: 'feedback',
        sourceRevision: 2,
        openedReason: 'feedback_submitted',
        supersedesCycleNumber: 1,
      },
      head: {
        currentCycleNumber: 2,
        currentSourceRevision: 2,
        stateRevision: 2,
        status: 'open',
      },
      transitions: [
        {
          cycleNumber: 2,
          stateRevision: 2,
          kind: 'opened',
          transitionReason: 'feedback_submitted',
          actorType: 'guest',
          triggerEventId: 'feedback-submitted-2',
        },
      ],
    })
  })

  it.each(['provider_reply_deleted', 'provider_reply_diverged'] as const)(
    'rejects %s while the current handling cycle is open',
    (openedReason) => {
      const result = nextCycle(reviewCycleHead({ status: 'open' }), {
        sourceRevision: 1,
        openedReason,
        triggerEventId: 'provider-reply-changed',
      })

      expect(errorOf(result).message).toBe('Only a closed Handling Cycle can be reopened')
    },
  )

  it('reopens a closed Review cycle after the provider reply diverges', () => {
    const result = nextCycle(reviewCycleHead(), {
      sourceRevision: 1,
      openedReason: 'provider_reply_diverged',
      triggerEventId: 'provider-reply-diverged',
    })

    expect(okOf(result).transitions).toEqual([
      expect.objectContaining({
        cycleNumber: 2,
        stateRevision: 2,
        kind: 'reopened',
        transitionReason: 'provider_reply_diverged',
        actorType: 'provider',
        actorUserId: null,
        triggerEventId: 'provider-reply-diverged',
      }),
    ])
  })

  it('rejects a same-source reopen that changes the source revision', () => {
    const result = nextCycle(reviewCycleHead(), {
      openedReason: 'provider_reply_deleted',
      triggerEventId: 'provider-reply-deleted',
    })

    expect(errorOf(result)).toMatchObject({
      code: 'invalid_input',
      message: 'A same-source reopen must keep the current Material Review Revision',
      context: {
        currentSourceRevision: 1,
        requestedSourceRevision: 2,
      },
    })
  })

  it('closes an open Review cycle before opening its advanced revision', () => {
    const result = nextCycle(reviewCycleHead({ status: 'open', stateRevision: 4 }), {
      triggerEventId: 'review-changed-2',
    })

    const value = okOf(result)
    expect(value.head).toMatchObject({
      currentCycleNumber: 2,
      currentSourceRevision: 2,
      stateRevision: 6,
      status: 'open',
    })
    expect(value.transitions).toEqual([
      expect.objectContaining({
        cycleNumber: 1,
        stateRevision: 5,
        sourceRevision: 1,
        kind: 'closed',
        transitionReason: 'superseded_by_source_revision',
      }),
      expect.objectContaining({
        cycleNumber: 2,
        stateRevision: 6,
        sourceRevision: 2,
        kind: 'opened',
        transitionReason: 'material_revision_changed',
      }),
    ])
  })

  it.each([
    ['cycle number', { currentCycleNumber: Number.MAX_SAFE_INTEGER }],
    ['state revision', { stateRevision: Number.MAX_SAFE_INTEGER }],
  ] as const)('rejects the next cycle when the %s would overflow', (_, overrides) => {
    const result = nextCycle(reviewCycleHead(overrides), {
      triggerEventId: 'review-changed-2',
    })

    expect(errorOf(result)).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle revision limit reached',
    })
  })

  it('rejects closing an already closed cycle', () => {
    const result = closeCycle(reviewCycleHead())

    expect(errorOf(result)).toMatchObject({
      code: 'invalid_transition',
      message: 'Handling Cycle is already closed',
    })
  })

  it.each([
    { actorType: 'user' as const, actorUserId: null },
    { actorType: 'system' as const, actorUserId: USER_ID },
  ])('rejects inconsistent actor attribution when closing a cycle', (actor) => {
    const result = closeCycle(reviewCycleHead({ status: 'open' }), actor)

    expect(errorOf(result)).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle actor attribution is invalid',
    })
  })

  it('rejects closing a cycle when its state revision would overflow', () => {
    const result = closeCycle(
      reviewCycleHead({ stateRevision: Number.MAX_SAFE_INTEGER, status: 'open' }),
    )

    expect(errorOf(result)).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle revision limit reached',
    })
  })
})
