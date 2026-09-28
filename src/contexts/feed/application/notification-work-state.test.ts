import { describe, expect, it, vi } from 'vitest'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { HandlingCycleNotificationFacts } from './ports/notification-inbox-item-lookup.port'
import type { ReplyWorkStatus } from './ports/reply-work-state.port'
import { createNotificationWorkState } from './notification-work-state'

const ORG = organizationId('org-work')
const ITEM = inboxItemId('item-work')
const REVIEW = '95000000-0000-4000-8000-000000000003'
const PORTAL = '95000000-0000-4000-8000-000000000006'
const PROPERTY = '95000000-0000-4000-8000-000000000001'

const cycle = (
  overrides: Partial<HandlingCycleNotificationFacts> = {},
): HandlingCycleNotificationFacts => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: null,
  sourceType: 'review',
  sourceId: REVIEW,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  currentCycleNumber: 2,
  currentSourceRevision: 1,
  stateRevision: 4,
  status: 'open',
  ...overrides,
})

function build(
  overrides: Partial<{
    isEscalated: boolean | null
    cycle: HandlingCycleNotificationFacts | null
    reply: ReplyWorkStatus | null
    managers: ReadonlyArray<string>
  }> = {},
) {
  const deps = {
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () =>
        overrides.isEscalated === null
          ? null
          : {
              propertyId: propertyId(PROPERTY),
              assignedTo: null,
              propertyName: null,
              isEscalated: overrides.isEscalated ?? true,
              resolvedAt: null,
              resolvedBy: null,
            },
      ),
    },
    inboxItemLookup: {
      findHandlingCycleNotificationFacts: vi.fn(async () =>
        overrides.cycle === undefined ? cycle() : overrides.cycle,
      ),
    },
    replyStates: {
      findReplyStatus: vi.fn(async () =>
        overrides.reply === undefined ? 'pending_approval' : overrides.reply,
      ),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => (overrides.managers ?? []).map(userId)),
      findForPortal: vi.fn(async () => (overrides.managers ?? []).map(userId)),
    },
  }
  return createNotificationWorkState(deps as never)
}

const ask = (
  state: ReturnType<typeof build>,
  type: Parameters<ReturnType<typeof build>['isWaiting']>[0]['type'],
  resourceId: string = ITEM,
  audience?: unknown,
) => state.isWaiting({ organizationId: ORG, type, resourceId, audience })

describe('whether the work a notice asks for still waits', () => {
  it('asks the Inbox whether an escalation still stands', async () => {
    await expect(ask(build(), 'inbox.escalated')).resolves.toBe(true)
    await expect(ask(build({ isEscalated: false }), 'inbox.escalated')).resolves.toBe(
      false,
    )
  })

  it('neither holds back nor retires what the owner cannot answer for', async () => {
    await expect(ask(build({ isEscalated: null }), 'inbox.escalated')).resolves.toBe(true)
    await expect(ask(build({ cycle: null }), 'inbox.reopened')).resolves.toBe(true)
    await expect(
      build({ isEscalated: null }).finished({
        organizationId: ORG,
        resourceId: ITEM,
        types: ['inbox.escalated'],
      }),
    ).resolves.toEqual(['inbox.escalated'])
  })

  it('asks Review whether the reply still waits for a decision or a retry', async () => {
    await expect(ask(build(), 'reply.pending_approval')).resolves.toBe(true)
    await expect(
      ask(build({ reply: 'approved' }), 'reply.pending_approval'),
    ).resolves.toBe(false)
    await expect(
      ask(build({ reply: 'publish_failed' }), 'reply.publish_failed'),
    ).resolves.toBe(true)
    await expect(ask(build({ reply: 'draft' }), 'reply.publish_failed')).resolves.toBe(
      false,
    )
    await expect(ask(build({ reply: null }), 'reply.pending_approval')).resolves.toBe(
      false,
    )
  })

  it('treats a reply notice on an item that is not a review as finished', async () => {
    const feedback = build({ cycle: cycle({ sourceType: 'feedback' }) })

    await expect(ask(feedback, 'reply.pending_approval')).resolves.toBe(false)
  })

  it('keeps an item notice waiting only while its item is open', async () => {
    for (const type of [
      'review.created',
      'review.updated',
      'feedback.created',
      'inbox.reopened',
      'inbox.response_target_passed',
    ] as const) {
      await expect(ask(build(), type)).resolves.toBe(true)
      await expect(
        ask(build({ cycle: cycle({ status: 'closed' }) }), type),
      ).resolves.toBe(false)
    }
  })

  it('keeps a responsibility request waiting only while nobody is responsible', async () => {
    await expect(ask(build(), 'property.responsibility_needed', PROPERTY)).resolves.toBe(
      true,
    )
    await expect(
      ask(build({ managers: ['manager-1'] }), 'portal.responsibility_needed', PORTAL),
    ).resolves.toBe(false)
  })

  it('never holds back a notice whose work it cannot check', async () => {
    await expect(ask(build({ reply: null }), 'reply.approved')).resolves.toBe(true)
  })
})

describe('which of a settling fact’s types are finished', () => {
  it('keeps a type whose work was asked for again, and settles the rest', async () => {
    const state = build({ reply: 'pending_approval' })

    await expect(
      state.finished({
        organizationId: ORG,
        resourceId: ITEM,
        types: ['reply.pending_approval', 'reply.publish_failed'],
      }),
    ).resolves.toEqual(['reply.publish_failed'])
  })

  it('settles a type it cannot check', async () => {
    await expect(
      build().finished({
        organizationId: ORG,
        resourceId: 'connection-1',
        types: ['integration.reauthorization_required'],
      }),
    ).resolves.toEqual(['integration.reauthorization_required'])
  })
})
