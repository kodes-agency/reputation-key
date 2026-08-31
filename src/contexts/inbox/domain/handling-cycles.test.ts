import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  closeHandlingCycle,
  createInitialHandlingCycle,
  createInitialReviewHandlingCycle,
  createNextHandlingCycle,
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
        sourceType: 'review',
        sourceId: REVIEW_ID,
        sourceRevision: 4,
        reviewId: REVIEW_ID,
        materialReviewRevision: 4,
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
        reviewId: REVIEW_ID,
        currentMaterialReviewRevision: 4,
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
    const current = {
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'review' as const,
      sourceId: REVIEW_ID,
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'closed' as const,
    }

    const result = createNextHandlingCycle({
      current,
      sourceRevision: 5,
      openedReason: 'material_revision_changed',
      openedBy: null,
      actorType: 'provider',
      triggerEventId: '4e000000-0000-0000-0000-000000000090',
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.cycle).toMatchObject({
      cycleNumber: 3,
      sourceRevision: 5,
      supersedesCycleNumber: 2,
      openedReason: 'material_revision_changed',
    })
    expect(result.value.head).toMatchObject({
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
    const feedback = feedbackId('4e000000-0000-0000-0000-000000000004')
    const result = createInitialHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'feedback',
      sourceId: feedback,
      sourceRevision: 2,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: 'guest-feedback-event-2',
      openedAt: OPENED_AT,
      status: 'open',
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toMatchObject({
      cycle: {
        sourceType: 'feedback',
        sourceId: feedback,
        sourceRevision: 2,
        openedReason: 'feedback_submitted',
      },
      head: {
        sourceType: 'feedback',
        sourceId: feedback,
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
    const feedback = feedbackId('4e000000-0000-0000-0000-000000000004')
    const initial = createInitialHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'feedback',
      sourceId: feedback,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: 'guest-feedback-event-1',
      openedAt: OPENED_AT,
      status: 'open',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const closed = closeHandlingCycle({
      current: initial.value.head,
      closeReason: 'guest_withdrawn',
      actorType: 'guest',
      actorUserId: null,
      triggerEventId: 'guest-feedback-retracted-1',
      closedAt: new Date('2026-08-26T09:00:00.000Z'),
    })

    expect(closed.isOk()).toBe(true)
    if (closed.isErr()) return
    expect(closed.value.head).toMatchObject({ status: 'closed', stateRevision: 2 })
    expect(closed.value.transition).toMatchObject({
      cycleNumber: 1,
      sourceRevision: 1,
      kind: 'closed',
      transitionReason: 'guest_withdrawn',
      actorType: 'guest',
      actorUserId: null,
      triggerEventId: 'guest-feedback-retracted-1',
    })
    expect(initial.value.cycle).toMatchObject({
      cycleNumber: 1,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
    })
  })

  it('never turns a rating-only Guest correction into a new feedback cycle', () => {
    const feedback = feedbackId('4e000000-0000-0000-0000-000000000004')
    const initial = createInitialHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'feedback',
      sourceId: feedback,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: 'guest-feedback-event-1',
      openedAt: OPENED_AT,
      status: 'open',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const attempted = createNextHandlingCycle({
      current: initial.value.head,
      sourceRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      actorType: 'guest',
      triggerEventId: 'guest-rating-corrected-1',
      openedAt: OPENED_AT,
    })

    expect(attempted.isErr()).toBe(true)
  })

  it('allows a manual reopen to create another cycle on the same material revision', () => {
    const initial = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 4,
      openedAt: OPENED_AT,
      status: 'closed',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const reopened = createNextReviewHandlingCycle({
      current: initial.value.head,
      materialReviewRevision: 4,
      openedReason: 'manual_reopen',
      manualReopenReason: 'guest_follow_up_still_needed',
      manualReopenExplanation: null,
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })

    expect(reopened.isOk()).toBe(true)
    if (reopened.isErr()) return
    expect(reopened.value.cycle).toMatchObject({
      cycleNumber: 2,
      sourceRevision: 4,
      openedBy: USER_ID,
      manualReopenReason: 'guest_follow_up_still_needed',
      manualReopenExplanation: null,
      supersedesCycleNumber: 1,
    })
  })

  it('requires and trims an explanation only for the Other reopen reason', () => {
    const initial = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 4,
      openedAt: OPENED_AT,
      status: 'closed',
    })
    expect(initial.isOk()).toBe(true)
    if (initial.isErr()) return

    const missing = createNextReviewHandlingCycle({
      current: initial.value.head,
      materialReviewRevision: 4,
      openedReason: 'manual_reopen',
      manualReopenReason: 'other',
      manualReopenExplanation: '   ',
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })
    expect(missing.isErr()).toBe(true)

    const reopened = createNextReviewHandlingCycle({
      current: initial.value.head,
      materialReviewRevision: 4,
      openedReason: 'manual_reopen',
      manualReopenReason: 'other',
      manualReopenExplanation: '  A new guest message needs a response.  ',
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })
    expect(reopened.isOk()).toBe(true)
    if (reopened.isErr()) return
    expect(reopened.value.cycle).toMatchObject({
      manualReopenReason: 'other',
      manualReopenExplanation: 'A new guest message needs a response.',
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

type CycleHead = Parameters<typeof createNextHandlingCycle>[0]['current']

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
  inboxItemId: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType: 'feedback',
  sourceId: feedbackId('4e000000-0000-0000-0000-000000000004'),
  currentCycleNumber: 1,
  currentSourceRevision: 1,
  stateRevision: 1,
  status: 'closed',
  ...overrides,
})

describe('source-neutral Handling Cycle invariants', () => {
  it('rejects a non-positive revision through the Review compatibility seam', () => {
    const result = createInitialReviewHandlingCycle({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      materialReviewRevision: 0,
      openedAt: OPENED_AT,
      status: 'open',
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
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
      sourceId: feedbackId('4e000000-0000-0000-0000-000000000004'),
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

      expect(result.isErr()).toBe(true)
      if (result.isOk()) return
      expect(result.error).toMatchObject({
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
      const result = createNextHandlingCycle({
        current: reviewCycleHead(overrides),
        sourceRevision: revision,
        openedReason: 'material_revision_changed',
        openedBy: null,
        actorType: 'provider',
        triggerEventId: 'review-changed-2',
        openedAt: OPENED_AT,
      })

      expect(result.isErr()).toBe(true)
      if (result.isOk()) return
      expect(result.error).toMatchObject({
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
  ])('rejects a manual reopen when $label', (testCase) => {
    const result = createNextHandlingCycle({
      current: testCase.current,
      sourceRevision: 1,
      openedReason: 'manual_reopen',
      manualReopenReason: testCase.manualReopenReason,
      openedBy: testCase.openedBy,
      actorType: testCase.actorType,
      triggerEventId: null,
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
      message: testCase.message,
    })
  })

  it('requires an explanation when a manager chooses Other', () => {
    const result = createNextHandlingCycle({
      current: reviewCycleHead(),
      sourceRevision: 1,
      openedReason: 'manual_reopen',
      manualReopenReason: 'other',
      openedBy: USER_ID,
      actorType: 'user',
      triggerEventId: null,
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toBe(
      'Other manual reopen reason requires a short explanation',
    )
  })

  it('rejects an explanation when a manager chooses a named reason', () => {
    const result = createNextHandlingCycle({
      current: reviewCycleHead(),
      sourceRevision: 1,
      openedReason: 'manual_reopen',
      manualReopenReason: 'new_information',
      manualReopenExplanation: 'This text belongs only with Other.',
      openedBy: USER_ID,
      actorType: 'user',
      triggerEventId: null,
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toBe(
      'A manual reopen explanation is only valid for Other',
    )
  })

  it.each([
    { manualReopenReason: 'new_information' as const },
    { manualReopenExplanation: 'Manager-only context' },
  ])('rejects manager reopen context on a system-opened cycle', (reopenContext) => {
    const result = createNextHandlingCycle({
      current: reviewCycleHead(),
      sourceRevision: 2,
      openedReason: 'material_revision_changed',
      ...reopenContext,
      openedBy: null,
      actorType: 'provider',
      triggerEventId: 'review-changed-2',
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toBe('System-opened cycles cannot carry a reopen reason')
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
    const result = createNextHandlingCycle({
      current,
      sourceRevision,
      openedReason: 'feedback_submitted',
      openedBy: null,
      actorType: 'guest',
      triggerEventId: 'feedback-submitted-2',
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error.message).toBe(
      'A new private-feedback occurrence must advance the Guest revision',
    )
  })

  it('opens the next Feedback handling episode when private feedback advances', () => {
    const result = createNextHandlingCycle({
      current: feedbackCycleHead(),
      sourceRevision: 2,
      openedReason: 'feedback_submitted',
      openedBy: null,
      actorType: 'guest',
      triggerEventId: 'feedback-submitted-2',
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toMatchObject({
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
      const result = createNextHandlingCycle({
        current: reviewCycleHead({ status: 'open' }),
        sourceRevision: 1,
        openedReason,
        openedBy: null,
        actorType: 'provider',
        triggerEventId: 'provider-reply-changed',
        openedAt: OPENED_AT,
      })

      expect(result.isErr()).toBe(true)
      if (result.isOk()) return
      expect(result.error.message).toBe('Only a closed Handling Cycle can be reopened')
    },
  )

  it('reopens a closed Review cycle after the provider reply diverges', () => {
    const result = createNextHandlingCycle({
      current: reviewCycleHead(),
      sourceRevision: 1,
      openedReason: 'provider_reply_diverged',
      openedBy: null,
      actorType: 'provider',
      triggerEventId: 'provider-reply-diverged',
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.transitions).toEqual([
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
    const result = createNextHandlingCycle({
      current: reviewCycleHead(),
      sourceRevision: 2,
      openedReason: 'provider_reply_deleted',
      openedBy: null,
      actorType: 'provider',
      triggerEventId: 'provider-reply-deleted',
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'A same-source reopen must keep the current Material Review Revision',
      context: {
        currentSourceRevision: 1,
        requestedSourceRevision: 2,
      },
    })
  })

  it('closes an open Review cycle before opening its advanced revision', () => {
    const result = createNextHandlingCycle({
      current: reviewCycleHead({ status: 'open', stateRevision: 4 }),
      sourceRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      actorType: 'provider',
      triggerEventId: 'review-changed-2',
      openedAt: OPENED_AT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.head).toMatchObject({
      currentCycleNumber: 2,
      currentSourceRevision: 2,
      stateRevision: 6,
      status: 'open',
    })
    expect(result.value.transitions).toEqual([
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
    const result = createNextHandlingCycle({
      current: reviewCycleHead(overrides),
      sourceRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      actorType: 'provider',
      triggerEventId: 'review-changed-2',
      openedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle revision limit reached',
    })
  })

  it('rejects closing an already closed cycle', () => {
    const result = closeHandlingCycle({
      current: reviewCycleHead(),
      closeReason: 'confirmed_on_google',
      actorType: 'provider',
      actorUserId: null,
      triggerEventId: 'reply-confirmed',
      closedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      code: 'invalid_transition',
      message: 'Handling Cycle is already closed',
    })
  })

  it.each([
    { actorType: 'user' as const, actorUserId: null },
    { actorType: 'system' as const, actorUserId: USER_ID },
  ])('rejects inconsistent actor attribution when closing a cycle', (actor) => {
    const result = closeHandlingCycle({
      current: reviewCycleHead({ status: 'open' }),
      closeReason: 'confirmed_on_google',
      ...actor,
      triggerEventId: 'reply-confirmed',
      closedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle actor attribution is invalid',
    })
  })

  it('rejects closing a cycle when its state revision would overflow', () => {
    const result = closeHandlingCycle({
      current: reviewCycleHead({
        stateRevision: Number.MAX_SAFE_INTEGER,
        status: 'open',
      }),
      closeReason: 'confirmed_on_google',
      actorType: 'provider',
      actorUserId: null,
      triggerEventId: 'reply-confirmed',
      closedAt: OPENED_AT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isOk()) return
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'Handling Cycle revision limit reached',
    })
  })
})
