import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createConsumerRegistry } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { InboxContextBuildInput } from './build'
import { buildInboxContext } from './build'

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
      // LIF-01: the Organization Export contribution is a named capability of
      // its own, deliberately outside `publicApi` so no request path reaches it.
      'organizationExport',
      // LIF-01: the Organization lifecycle contribution is likewise a named
      // capability outside `publicApi`; only Identity's coordinator calls it.
      'organizationLifecycle',
      'publicApi',
      'runtime',
      'worker',
    ])
    expect(Object.keys(context.organizationExport)).toEqual(['contributor'])
    expect(context.organizationExport.contributor.context).toBe('inbox')
    expect(Object.isFrozen(context.organizationExport)).toBe(true)
    expect(Object.keys(context.organizationLifecycle)).toEqual(['contributor'])
    expect(context.organizationLifecycle.contributor.context).toBe('inbox')
    expect(Object.isFrozen(context.organizationLifecycle)).toBe(true)
    expect(Object.keys(context.publicApi)).not.toContain('organizationLifecycle')
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

  it('registers durable consumers unconditionally', () => {
    const context = build()
    const registry = createConsumerRegistry()

    context.worker.registerOutboxConsumers(registry)

    expect(registry.listFor('review.created')).toHaveLength(1)
  })
})
