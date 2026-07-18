// BQC-4.2 — dispatch-time routing enforcement tests.
//
// The gated dispatch runs: registry lookup → schedule classification →
// gateJob (3.2 policy) → ROUTING GATE → handler. The routing gate re-resolves
// the property's CURRENT routing via the ProcessingRouter for property-scoped
// protected jobs (sync-property-reviews, publish-reply):
//
//   blocked decision  → quarantine ('routing_blocked:<reason>'), no handler,
//                       no retry burn — fail closed (ADR 0048)
//   target cell ≠ the worker's declared cell → quarantine ('wrong_cell')
//   matching cell     → proceed; a stamped envelope whose routingPolicyVersion
//                       differs from the fresh resolution logs 'stale routing
//                       envelope — re-resolved at dispatch' (re-resolution IS
//                       the reschedule with one cell)
//
// The stamped routing envelope is telemetry: a tampered payload region NEVER
// influences the outcome — only the fresh resolution does (phase doc §4.2:
// "Region is never accepted only because it is present in the payload").

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import { createGatedJobHandler, type JobRoutingGate } from './delayed-execution-gate'
import { createJobRegistry } from './registry'
import type {
  ProcessingRouter,
  RoutingDecision,
  RoutingEnvelope,
} from '#/shared/routing/processing-router'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
} from '#/shared/auth/system-execution-policy'

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => loggerMocks,
}))

const ALLOW: DelayedDecision = {
  outcome: 'allow',
  allowed: true,
  reason: 'allowed',
  action: 'system:review.sync',
  policyVersion: 'bqc-2.4',
  freshRead: false,
}

const DENY_TERMINAL: DelayedDecision = {
  ...ALLOW,
  outcome: 'deny',
  allowed: false,
  reason: 'org_suspended',
}

const US_TARGET: RoutingDecision = {
  kind: 'target',
  cell: 'us',
  region: 'us',
  queue: 'default',
  routingPolicyVersion: 2,
}

function fakeJob(over: Record<string, unknown> = {}): Job {
  return {
    name: 'sync-property-reviews',
    id: 'job-1',
    data: { propertyId: 'prop-1', organizationId: 'org-1' },
    opts: {},
    attemptsMade: 0,
    ...over,
  } as unknown as Job
}

function stampedEnvelope(over: Partial<RoutingEnvelope> = {}): RoutingEnvelope {
  return {
    propertyId: 'prop-1',
    region: 'us',
    workloadClass: 'review.sync',
    routingPolicyVersion: 2,
    ...over,
  }
}

function setup(decision: DelayedDecision = ALLOW) {
  const decideMock = vi.fn(async () => decision)
  initDelayedExecutionPolicy({ decide: decideMock })
  const registry = createJobRegistry()
  const handler = vi.fn(async () => {})
  registry.register('sync-property-reviews', handler)
  registry.register('publish-reply', handler)
  registry.register('health-check', handler)
  const resolveMock = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
  const router: ProcessingRouter = { resolve: resolveMock }
  const quarantine = vi.fn(async () => {})
  const routing: JobRoutingGate = { router, cell: 'us', quarantine }
  return { registry, handler, resolveMock, quarantine, routing, decideMock }
}

afterEach(() => {
  resetDelayedExecutionPolicy()
  vi.clearAllMocks()
})

describe('dispatch routing gate (BQC-4.2)', () => {
  it('runs the handler when the fresh routing decision targets the worker cell', async () => {
    const { registry, handler, resolveMock, quarantine, routing } = setup()
    const dispatch = createGatedJobHandler('default', registry, undefined, routing)

    const job = fakeJob()
    await dispatch(job)

    expect(resolveMock).toHaveBeenCalledWith('prop-1', 'review.sync')
    expect(handler).toHaveBeenCalledWith(job)
    expect(quarantine).not.toHaveBeenCalled()
  })

  it.each([
    { reason: 'region_denied', region: 'europe' },
    { reason: 'region_unresolved', region: 'unresolved' },
    { reason: 'property_missing', region: null },
  ])(
    'quarantines a blocked decision ($reason) without invoking the handler or throwing',
    async ({ reason, region }) => {
      const { registry, handler, resolveMock, quarantine, routing } = setup()
      resolveMock.mockResolvedValue({
        kind: 'blocked',
        reason,
        region,
      } as RoutingDecision)
      const dispatch = createGatedJobHandler('default', registry, undefined, routing)

      const job = fakeJob()
      await expect(dispatch(job)).resolves.toBeUndefined()

      expect(handler).not.toHaveBeenCalled()
      expect(quarantine).toHaveBeenCalledTimes(1)
      expect(quarantine).toHaveBeenCalledWith(job, `routing_blocked:${reason}`)
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: 'sync-property-reviews', reason }),
        expect.stringMatching(/routing blocked/),
      )
    },
  )

  it('quarantines a job whose target cell differs from the worker cell (wrong cell)', async () => {
    const { registry, handler, quarantine, routing } = setup()
    // Worker misconfigured for another cell while every target is 'us'
    // (ADR 0048: one approved cell) — the tamper/misconfig case fails closed.
    const dispatch = createGatedJobHandler('default', registry, undefined, {
      ...routing,
      cell: 'europe',
    })

    const job = fakeJob()
    await expect(dispatch(job)).resolves.toBeUndefined()

    expect(handler).not.toHaveBeenCalled()
    expect(quarantine).toHaveBeenCalledWith(job, 'wrong_cell')
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ targetCell: 'us', workerCell: 'europe' }),
      expect.stringMatching(/another cell/),
    )
  })

  it('proceeds on the FRESH resolution when the stamped envelope region is tampered', async () => {
    const { registry, handler, resolveMock, quarantine, routing } = setup()
    const dispatch = createGatedJobHandler('default', registry, undefined, routing)

    // Payload claims 'europe'; the property's current routing resolves to the
    // approved 'us' cell — the fresh decision wins, the stamp is ignored.
    const job = fakeJob({
      data: {
        propertyId: 'prop-1',
        organizationId: 'org-1',
        routing: stampedEnvelope({ region: 'europe', routingPolicyVersion: 2 }),
      },
    })
    await dispatch(job)

    expect(resolveMock).toHaveBeenCalledWith('prop-1', 'review.sync')
    expect(handler).toHaveBeenCalledWith(job)
    expect(quarantine).not.toHaveBeenCalled()
  })

  it('proceeds on the fresh resolution when the stamped policy version is stale, and logs it', async () => {
    const { registry, handler, quarantine, routing } = setup()
    const dispatch = createGatedJobHandler('default', registry, undefined, routing)

    const job = fakeJob({
      data: {
        propertyId: 'prop-1',
        organizationId: 'org-1',
        routing: stampedEnvelope({ routingPolicyVersion: 1 }), // fresh: 2
      },
    })
    await dispatch(job)

    expect(handler).toHaveBeenCalledWith(job)
    expect(quarantine).not.toHaveBeenCalled()
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ stampedVersion: 1, resolvedVersion: 2 }),
      'stale routing envelope — re-resolved at dispatch',
    )
  })

  it('resolves publish-reply property scope via the scope resolver and routes reply.publish', async () => {
    const { registry, handler, resolveMock, quarantine, routing } = setup()
    const resolveScope = vi.fn(async () => 'prop-from-reply')
    const dispatch = createGatedJobHandler('default', registry, resolveScope, routing)

    const job = fakeJob({
      name: 'publish-reply',
      data: { replyId: 'reply-1', organizationId: 'org-1' },
    })
    await dispatch(job)

    expect(resolveMock).toHaveBeenCalledWith('prop-from-reply', 'reply.publish')
    expect(handler).toHaveBeenCalledWith(job)
    expect(quarantine).not.toHaveBeenCalled()
  })

  it('fails closed when a routed job has no resolvable property scope', async () => {
    const { registry, handler, quarantine, routing } = setup()
    const resolveScope = vi.fn(async () => undefined)
    const dispatch = createGatedJobHandler('default', registry, resolveScope, routing)

    const job = fakeJob({
      name: 'publish-reply',
      data: { replyId: 'reply-1', organizationId: 'org-1' },
    })
    await expect(dispatch(job)).resolves.toBeUndefined()

    expect(handler).not.toHaveBeenCalled()
    expect(quarantine).toHaveBeenCalledWith(job, 'routing_blocked:property_missing')
  })

  it('never routes tenant-cross / unrouted jobs (router not consulted)', async () => {
    const { registry, handler, resolveMock, quarantine, routing } = setup()
    const dispatch = createGatedJobHandler('background', registry, undefined, routing)

    const job = fakeJob({ name: 'health-check', data: {} })
    await dispatch(job)

    expect(resolveMock).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith(job)
    expect(quarantine).not.toHaveBeenCalled()
  })

  it('does not consult the router when the policy gate denies (policy → routing → handler order)', async () => {
    const { registry, handler, resolveMock, quarantine, routing } = setup(DENY_TERMINAL)
    const dispatch = createGatedJobHandler('default', registry, undefined, routing)

    await expect(dispatch(fakeJob())).resolves.toBeUndefined()

    expect(resolveMock).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(quarantine).not.toHaveBeenCalled()
  })

  it('skips routing entirely when no routing gate is wired (3.2 behavior unchanged)', async () => {
    const { registry, handler } = setup()
    const dispatch = createGatedJobHandler('default', registry)

    const job = fakeJob()
    await dispatch(job)

    expect(handler).toHaveBeenCalledWith(job)
  })
})
