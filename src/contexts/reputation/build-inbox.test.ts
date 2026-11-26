import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createConsumerRegistry } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { ReviewLookupPort } from './inbox/review-lookup.port.server'
import type { InboxContextBuildInput } from './build-inbox'
import { buildInboxContext } from './build-inbox'

describe('buildInboxContext', () => {
  function build() {
    return buildInboxContext({
      db: {} as Database,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      idGen: () => '00000000-0000-4000-8000-000000000001',
      staffPublicApi: {} as StaffPublicApi,
      reviewLookup: {} as ReviewLookupPort,
      sources: {
        feedback: {},
        property: {},
        reply: {},
        review: {},
        replyObservationAuthority: {},
        responseTargetAuthority: {},
        sourceTransitionAuthority: {},
        googleReviewCheck: {},
      } as InboxContextBuildInput['sources'],
      rateLimiter: {
        check: async () => {
          throw new Error('unused')
        },
      },
      logger: createMockLogger(),
      authorizeCommand: async () => ({ allowed: true }),
    })
  }

  it('separates request, maintenance, and worker capabilities', () => {
    const context = build()

    // Export and erasure run through the rights request executors, never from
    // this build.
    expect(Object.keys(context).sort()).toEqual([
      // Named member-authority and scheduled-release capabilities.
      'assignments',
      'maintenance',
      'publicApi',
      'runtime',
      'worker',
    ])
    expect(Object.keys(context.publicApi)).not.toContain('organizationExport')
    expect(Object.keys(context.publicApi)).not.toContain('organizationLifecycle')
    // No raw item creation: the durable source consumers create Inbox Items,
    // under their receipts and after their source checks (Invariant 1).
    expect(Object.keys(context.publicApi)).not.toContain('createInboxItem')
    expect(Object.keys(context.publicApi)).not.toContain('startReviewHandlingCycle')
    expect(Object.keys(context.maintenance)).toEqual([
      'rebuildInboxProjection',
      'responseTargetExclusions',
    ])
    expect(Object.keys(context.worker)).toEqual(['registerOutboxConsumers'])
    expect(Object.isFrozen(context.maintenance)).toBe(true)
  })

  it('binds each named capability to the one Inbox-owned implementation', () => {
    const context = build()

    expect(context.maintenance.rebuildInboxProjection).toBeTypeOf('function')
    expect(Object.keys(context.maintenance.responseTargetExclusions).sort()).toEqual([
      'apply',
      'findProperty',
      'scan',
    ])
  })

  it('registers durable consumers unconditionally', () => {
    const context = build()
    const registry = createConsumerRegistry()

    context.worker.registerOutboxConsumers(registry)

    expect(registry.listFor('review.created')).toHaveLength(1)
    expect(registry.listFor('property.archived')).toHaveLength(1)
    expect(
      registry.list().map(({ eventType, consumerName }) => [eventType, consumerName]),
    ).toEqual([
      ['review.created', 'inbox.on-review-created'],
      ['review.updated', 'inbox.on-review-updated'],
      ['review.source_transitioned', 'inbox.on-review-source-transitioned'],
      ['review.reply.observed', 'inbox.on-reply-observed'],
      ['review.reply.submitted', 'inbox.on-reply-submitted'],
      ['guest.feedback.submitted', 'inbox.on-guest-feedback-submitted'],
      ['guest.feedback.retracted', 'inbox.on-guest-feedback-retracted'],
      ['property.archived', 'inbox.on-property-archived'],
      ['identity.member.removed', 'inbox.on-member-removed'],
    ])
  })
})
