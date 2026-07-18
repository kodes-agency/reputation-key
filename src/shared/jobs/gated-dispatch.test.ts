// BQC-3.2 — gated job dispatch factory tests.
//
// createGatedJobHandler produces the single worker dispatch closure shared by
// the default/background BullMQ workers. It classifies schedule firings,
// authorizes through gateJob, and converts the outcome into runtime behavior:
// allow → invoke, deny_terminal → typed skip (no side effect, no retry),
// deny_retry → throw so BullMQ backoff applies (policy unavailability is
// transient, not a revocation).

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import { createGatedJobHandler } from './delayed-execution-gate'
import { JobTimeoutError, UnknownJobError } from './errors'
import { createJobRegistry } from './registry'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
  type DelayedDecisionRequest,
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

const decideMock = vi.fn<(r: DelayedDecisionRequest) => Promise<DelayedDecision>>()

function decision(over: Partial<DelayedDecision> = {}): DelayedDecision {
  return {
    outcome: 'deny',
    allowed: false,
    reason: 'capability_blocked',
    action: 'system:health.check',
    policyVersion: 'bqc-2.4',
    freshRead: false,
    ...over,
  }
}

const ALLOW = decision({ outcome: 'allow', allowed: true, reason: 'allowed' })

function fakeJob(over: Record<string, unknown> = {}): Job {
  return {
    name: 'health-check',
    id: 'job-1',
    data: {},
    opts: {},
    attemptsMade: 0,
    ...over,
  } as unknown as Job
}

afterEach(() => {
  resetDelayedExecutionPolicy()
  vi.clearAllMocks()
})

describe('createGatedJobHandler', () => {
  it('invokes the registered handler when the gate allows', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('default', registry)

    const job = fakeJob()
    await dispatch(job)

    expect(handler).toHaveBeenCalledWith(job)
  })

  it('skips the handler and resolves on deny_terminal', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'org_suspended' }))
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('default', registry)

    await expect(dispatch(fakeJob())).resolves.toBeUndefined()

    expect(handler).not.toHaveBeenCalled()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'health-check',
        reason: 'org_suspended',
        policyVersion: 'bqc-2.4',
      }),
      'delayed execution denied — terminal',
    )
  })

  it('throws on deny_retry so BullMQ retries with backoff', async () => {
    decideMock.mockResolvedValue(
      decision({ reason: 'policy_unavailable', freshRead: true }),
    )
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('default', registry)

    await expect(dispatch(fakeJob())).rejects.toThrow(/policy_unavailable/)

    expect(handler).not.toHaveBeenCalled()
  })

  it('throws UnknownJobError for unknown jobs without consulting the policy (BQC-3.6)', async () => {
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const dispatch = createGatedJobHandler('background', registry)

    // BQC-3.6: an unknown job name is a deployment/config failure, never a
    // silent success — the job fails, burns attempts, and lands in quarantine
    // (§4) instead of being acked away by BullMQ.
    const job = fakeJob({ name: 'unregistered-job', id: 'job-unknown-1' })
    await expect(dispatch(job)).rejects.toThrow(UnknownJobError)
    await expect(dispatch(job)).rejects.toThrow(/unregistered-job/)

    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'unregistered-job', jobId: 'job-unknown-1' }),
      expect.stringMatching(/no handler registered/),
    )
    expect(decideMock).not.toHaveBeenCalled()
  })

  it("classifies '-recurring' jobIds as schedule firings with a schedule principal", async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    registry.register(
      'health-check',
      vi.fn(async () => {}),
    )
    const dispatch = createGatedJobHandler('background', registry)

    await dispatch(
      fakeJob({
        id: 'health-check-recurring',
        opts: { jobId: 'health-check-recurring' },
      }),
    )

    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'schedule:health-check' },
      executionKind: 'schedule',
    })
  })

  it('classifies BullMQ repeatJobKey jobs as schedule firings', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    registry.register(
      'health-check',
      vi.fn(async () => {}),
    )
    const dispatch = createGatedJobHandler('background', registry)

    await dispatch(fakeJob({ repeatJobKey: 'health-check:1700000000000' }))

    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'schedule:health-check' },
      executionKind: 'schedule',
    })
  })

  it('classifies plain jobs as worker executions with a queue-labeled principal', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    registry.register(
      'health-check',
      vi.fn(async () => {}),
    )
    const dispatch = createGatedJobHandler('default', registry)

    await dispatch(fakeJob())

    expect(decideMock.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'system', id: 'worker:default' },
      executionKind: 'worker',
    })
  })

  it('fails a job that exceeds its catalogue timeout (BQC-3.6)', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    registry.register(
      'health-check',
      vi.fn(() => new Promise<void>(() => {})), // never resolves
    )
    const dispatch = createGatedJobHandler('default', registry, undefined, () => 5)

    await expect(dispatch(fakeJob())).rejects.toThrow(JobTimeoutError)
  })

  it('lets a job that finishes inside its timeout complete', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('default', registry, undefined, () => 1_000)

    await expect(dispatch(fakeJob())).resolves.toBeUndefined()
    expect(handler).toHaveBeenCalledOnce()
  })
})
