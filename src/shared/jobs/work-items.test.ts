import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { createGatedJobHandler } from './delayed-execution-gate'
import { createJobRegistry } from './registry'
import { reconcileWorkItems, startWorkItemReconciler } from './work-items.server'
import type { WorkItems } from './work-items.server'

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('ledger scope at the dispatch gate', () => {
  const kind = 'sync-property-reviews'
  const job = (data: unknown = { workId: 'work-1' }) =>
    ({ name: kind, data, opts: {} }) as Job
  const work = {
    kind,
    organizationId: 'org-1',
    subjectId: 'property-1',
  }

  function dispatchFixture(env = {}) {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
    const refreshPolicy = vi.fn(async () => {})
    initDelayedExecutionPolicy(createDelayedExecutionPolicy({ refreshPolicy }))
    const registry = createJobRegistry()
    const handler = vi.fn(async () => 'completed')
    registry.register(kind, handler)
    const resolveDispatch = vi.fn<WorkItems['resolveDispatch']>(async () => work)
    const resolveScope = vi.fn(async (_name: string, data: unknown) => {
      const scope = data as typeof work
      return scope.organizationId === work.organizationId ? scope.subjectId : undefined
    })
    const dispatch = createGatedJobHandler(
      'default',
      registry,
      resolveScope,
      undefined,
      resolveDispatch,
    )
    return { dispatch, handler, resolveDispatch, resolveScope, refreshPolicy }
  }

  it('resolves the ledger tenant and subject before current policy and keeps the IDs-only handler payload', async () => {
    const { dispatch, handler, resolveDispatch, resolveScope, refreshPolicy } =
      dispatchFixture()
    const queued = job()
    await expect(dispatch(queued)).resolves.toBe('completed')
    expect(resolveDispatch).toHaveBeenCalledWith('work-1')
    expect(resolveScope).toHaveBeenCalledWith(kind, {
      workId: 'work-1',
      organizationId: work.organizationId,
      subjectId: work.subjectId,
    })
    expect(refreshPolicy).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(queued)
    expect(queued.data).toEqual({ workId: 'work-1' })
  })

  it.each([
    [{ BETA_SUSPENDED_ORGS: 'org-1' }, 'org_suspended'],
    [{ BETA_CAPABILITIES_OFF: 'property.connect_gbp' }, 'capability_disabled'],
  ])('retains current policy denial for ledger work: %s', async (env, reason) => {
    const { dispatch, handler } = dispatchFixture(env)
    await expect(
      dispatch(
        job({
          workId: 'work-1',
          organizationId: 'other-org',
          propertyId: 'other-property',
        }),
      ),
    ).resolves.toMatchObject({ gate: 'denied', reason })
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps policy unavailability retryable before any handler effect', async () => {
    const { dispatch, handler, refreshPolicy } = dispatchFixture()
    refreshPolicy.mockRejectedValue(new Error('unavailable'))
    await expect(dispatch(job())).rejects.toThrow('policy_unavailable')
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies unresolved Property scope rather than trusting a queued Property', async () => {
    const { dispatch, handler, resolveScope } = dispatchFixture()
    resolveScope.mockResolvedValue(undefined)
    await expect(
      dispatch(job({ workId: 'work-1', propertyId: 'untrusted-property' })),
    ).resolves.toMatchObject({ gate: 'denied', reason: 'missing_scope' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([null, '', 1])('rejects malformed work IDs: %s', async (workId) => {
    const { dispatch, handler, resolveDispatch } = dispatchFixture()
    await expect(dispatch(job({ workId }))).rejects.toThrow('Work dispatch unavailable')
    expect(resolveDispatch).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses ledger work when its dispatch reader was not installed', async () => {
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register(kind, handler)
    await expect(createGatedJobHandler('default', registry)(job())).rejects.toThrow(
      'Work dispatch unavailable',
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('propagates a ledger read failure without attempting work', async () => {
    const { dispatch, handler, resolveDispatch, refreshPolicy } = dispatchFixture()
    resolveDispatch.mockRejectedValue(new Error('ledger unavailable'))
    await expect(dispatch(job())).rejects.toThrow('ledger unavailable')
    expect(refreshPolicy).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([undefined, { ...work, kind: 'insert-notification' }])(
    'rejects a missing or differently bound work row without trusting queue scope',
    async (resolved) => {
      const { dispatch, handler, resolveDispatch, resolveScope } = dispatchFixture()
      resolveDispatch.mockResolvedValue(resolved)
      await expect(
        dispatch(
          job({
            workId: 'work-1',
            organizationId: 'other-org',
            propertyId: 'other-property',
          }),
        ),
      ).rejects.toThrow('Work dispatch unavailable')
      expect(resolveScope).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    },
  )
})

describe('durable work transport', () => {
  it('sends only the work ID and isolates a failed tenant without spending attempts', async () => {
    const reserveDispatch = vi.fn().mockResolvedValue([
      { id: 'a', kind: 'import', dispatchSequence: 1 },
      { id: 'b', kind: 'analysis', dispatchSequence: 3 },
    ])
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport unavailable'))
      .mockResolvedValueOnce(undefined)
    const result = await reconcileWorkItems({ reserveDispatch, enqueue })
    expect(result).toEqual({ queued: 1, failed: 1 })
    expect(enqueue.mock.calls).toEqual([
      ['import', { workId: 'a' }, 'a-1'],
      ['analysis', { workId: 'b' }, 'b-3'],
    ])
    expect(reserveDispatch).toHaveBeenCalledOnce()
  })

  it('recovers on boot and every minute, without overlapping or running after stop', async () => {
    vi.useFakeTimers()
    try {
      let release!: () => void
      const reconcile = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              release = resolve
            }),
        )
        .mockResolvedValue(undefined)
      const onError = vi.fn()
      const stop = startWorkItemReconciler({ reconcile, onError })
      expect(reconcile).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reconcile).toHaveBeenCalledOnce()
      release()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reconcile).toHaveBeenCalledTimes(2)
      await stop()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(onError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps reconciling after a database outage', async () => {
    vi.useFakeTimers()
    try {
      const reconcile = vi
        .fn()
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValue(undefined)
      const onError = vi.fn()
      const stop = startWorkItemReconciler({ reconcile, onError })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenCalledOnce()
      await stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drain waits for the active pass and prevents new passes', async () => {
    vi.useFakeTimers()
    try {
      let release!: () => void
      const reconcile = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const stop = startWorkItemReconciler({ reconcile, onError: vi.fn() })
      const drained = vi.fn()
      const stopped = stop().then(drained)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(drained).not.toHaveBeenCalled()
      expect(reconcile).toHaveBeenCalledOnce()
      release()
      await stopped
      expect(drained).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
