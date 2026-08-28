import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createEventBus } from '#/shared/events/event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { InboxContextBuildInput } from './build'
import { buildInboxContext } from './build'

describe('buildInboxContext', () => {
  function build() {
    return buildInboxContext({
      db: {} as Database,
      events: createEventBus(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      idGen: () => '00000000-0000-4000-8000-000000000001',
      cutoverState: () => 'record-only',
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
      } as InboxContextBuildInput['sources'],
      logger: createMockLogger(),
      authorizeCommand: async () => ({ allowed: true }),
    })
  }

  it('separates request, lifecycle, maintenance, and worker capabilities', () => {
    const context = build()

    expect(Object.keys(context).sort()).toEqual([
      // ARC-03-T12: named member-authority and scheduled-release capabilities.
      'assignments',
      'internal',
      'lifecycle',
      'maintenance',
      'publicApi',
      'runtime',
      'worker',
    ])
    expect(Object.keys(context.lifecycle).sort()).toEqual([
      'createInboxItem',
      'getInboxResponseTarget',
      'startReviewHandlingCycle',
    ])
    expect(Object.keys(context.maintenance)).toEqual(['rebuildInboxProjection'])
    expect(Object.keys(context.worker)).toEqual(['registerOutboxConsumers'])
    expect(Object.isFrozen(context.lifecycle)).toBe(true)
    expect(Object.isFrozen(context.maintenance)).toBe(true)
  })

  it('binds each named capability to the one Inbox-owned implementation', () => {
    const context = build()

    expect(context.lifecycle.createInboxItem).toBe(
      context.internal.useCases.createInboxItem,
    )
    expect(context.lifecycle.getInboxResponseTarget).toBe(
      context.internal.useCases.getInboxResponseTarget,
    )
    expect(context.lifecycle.startReviewHandlingCycle).toBe(
      context.internal.useCases.startReviewHandlingCycle,
    )
    expect(context.maintenance.rebuildInboxProjection).toBe(
      context.internal.useCases.rebuildInboxProjection,
    )
  })
})
