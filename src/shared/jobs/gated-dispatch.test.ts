// BQC-3.2 — gated job dispatch factory tests.
//
// createGatedJobHandler produces the single worker dispatch closure shared by
// the default/background BullMQ workers. It classifies schedule firings,
// authorizes through gateJob, and converts the outcome into runtime behavior:
// allow → invoke, deny_terminal → typed denial result (no side effect, no
// retry, never counted as a success),
// deny_retry → throw so BullMQ backoff applies (policy unavailability is
// transient, not a revocation).

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import { createGatedJobHandler } from './delayed-execution-gate'
import { JobTimeoutError, UnknownJobError } from './errors'
import { createJobRegistry } from './registry'
import { declareRequestProcess, getDatabaseScope } from '#/shared/db/tenant-scope.server'
import { resetScopeProcessForTest } from '#/shared/db/scope-store.server'
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
  resetScopeProcessForTest()
  resetDelayedExecutionPolicy()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
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

    expect(handler).toHaveBeenCalledWith(job, expect.any(AbortSignal))
  })

  it('returns the handler result to BullMQ for evidence-bearing jobs', async () => {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    registry.register('health-check', async () => ({ purged: 500 }))

    await expect(createGatedJobHandler('default', registry)(fakeJob())).resolves.toEqual({
      purged: 500,
    })
  })

  it('skips the handler and resolves a typed denial on deny_terminal', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'org_suspended' }))
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('default', registry)

    // BullMQ completes the job (a terminal denial must not retry); the typed
    // result is what keeps that completion from being counted as a success.
    await expect(dispatch(fakeJob())).resolves.toEqual({
      gate: 'denied',
      reason: 'org_suspended',
      executionKind: 'worker',
    })

    expect(handler).not.toHaveBeenCalled()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'health-check',
        reason: 'org_suspended',
        policyVersion: 'bqc-2.4',
        executionKind: 'worker',
      }),
      'delayed execution denied — terminal',
    )
  })

  it('reports a schedule-level terminal denial as an error, never as routine', async () => {
    decideMock.mockResolvedValue(decision({ reason: 'missing_scope' }))
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)
    const dispatch = createGatedJobHandler('background', registry)

    await expect(
      dispatch(fakeJob({ repeatJobKey: 'health-check:1700000000000' })),
    ).resolves.toEqual({
      gate: 'denied',
      reason: 'missing_scope',
      executionKind: 'schedule',
    })

    expect(handler).not.toHaveBeenCalled()
    expect(loggerMocks.warn).not.toHaveBeenCalled()
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'health-check',
        reason: 'missing_scope',
        executionKind: 'schedule',
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
      expect.objectContaining({ jobName: 'unregistered-job' }),
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

  it('aborts at the deadline and holds the slot until cooperative cleanup finishes', async () => {
    vi.useFakeTimers()
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    let signal: AbortSignal | undefined
    registry.register('health-check', (_job, abortSignal) => {
      signal = abortSignal
      return new Promise<void>((resolve) => {
        abortSignal?.addEventListener('abort', () => setTimeout(resolve, 10), {
          once: true,
        })
      })
    })
    const dispatch = createGatedJobHandler('default', registry, undefined, () => 5)
    let settled = false
    const outcome = dispatch(fakeJob()).catch((error: unknown) => {
      settled = true
      return error
    })

    await vi.advanceTimersByTimeAsync(5)
    expect(signal?.aborted).toBe(true)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    expect(await outcome).toBeInstanceOf(JobTimeoutError)
    expect(settled).toBe(true)
  })

  it('terminates an uncooperative worker after grace without releasing the slot', async () => {
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never)
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const work = Promise.withResolvers<void>()
    registry.register('health-check', () => work.promise)
    let settled = false
    const outcome = createGatedJobHandler(
      'default',
      registry,
      undefined,
      () => 5,
    )(fakeJob()).catch((error: unknown) => {
      settled = true
      return error
    })

    await vi.advanceTimersByTimeAsync(5)
    expect(settled).toBe(false)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(settled).toBe(false)
    // The real exit never returns. Settle the fake's work to avoid leaking it.
    work.resolve()
    expect(await outcome).toBeInstanceOf(JobTimeoutError)
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

describe('database scope of gated jobs', () => {
  function dispatchRecordingScope(jobName: string) {
    decideMock.mockResolvedValue(ALLOW)
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const seen: unknown[] = []
    registry.register(jobName, async () => {
      seen.push(getDatabaseScope())
    })
    return { dispatch: createGatedJobHandler('default', registry), seen }
  }

  it("runs Organization-scoped work under the payload's Organization", async () => {
    const { dispatch, seen } = dispatchRecordingScope('import-gbp-property-item')

    await dispatch(
      fakeJob({ name: 'import-gbp-property-item', data: { organizationId: 'org-1' } }),
    )

    expect(seen).toEqual([
      {
        kind: 'tenant',
        organizationId: 'org-1',
        entry: 'job',
        name: 'import-gbp-property-item',
      },
    ])
    expect(getDatabaseScope()).toBeUndefined()
  })

  it('runs tenant-cross and unscoped work as named system work', async () => {
    const { dispatch, seen } = dispatchRecordingScope('health-check')

    await dispatch(fakeJob())

    expect(seen).toEqual([{ kind: 'system', name: 'job:health-check' }])
  })

  it('enters no scope for a denied job', async () => {
    decideMock.mockResolvedValue(decision())
    initDelayedExecutionPolicy({ decide: decideMock })
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('health-check', handler)

    await createGatedJobHandler('default', registry)(fakeJob())

    expect(handler).not.toHaveBeenCalled()
  })

  it('cannot run system work in a request process', async () => {
    const { dispatch, seen } = dispatchRecordingScope('health-check')
    declareRequestProcess()

    await expect(dispatch(fakeJob())).rejects.toThrow('system database scope refused')
    expect(seen).toEqual([])
  })
})
