// Invariant harness tests — verifies the runner and the no-orphaned-jobs checker.
// The review-inbox and SLA checkers require DB-backed repos and are exercised
// through integration tests in Track 6 (scenario DSL).

import { describe, it, expect } from 'vitest'
import { runInvariants } from './index'
import { noOrphanedJobs } from './checkers/no-orphaned-jobs'
import { createInMemoryQueue } from '../in-memory-queue'
import { createJobRegistry } from '#/shared/jobs/registry'
import type { InvariantChecker, InvariantContext } from './types'

const CTX: InvariantContext = { organizationId: 'org-test-0001' }

describe('runInvariants', () => {
  it('returns ok=true when all checkers pass', async () => {
    const passingChecker: InvariantChecker = {
      id: 'always-pass',
      description: 'Always passes',
      check: async () => [],
    }

    const report = await runInvariants([passingChecker], CTX)

    expect(report.ok).toBe(true)
    expect(report.violations).toHaveLength(0)
    expect(report.totalCheckers).toBe(1)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
  })

  it('returns ok=false when a checker finds violations', async () => {
    const failingChecker: InvariantChecker = {
      id: 'always-fail',
      description: 'Always fails',
      check: async () => [
        {
          checker: 'always-fail',
          severity: 'error',
          message: 'Something is wrong',
        },
      ],
    }

    const report = await runInvariants([failingChecker], CTX)

    expect(report.ok).toBe(false)
    expect(report.violations).toHaveLength(1)
    expect(report.failed).toBe(1)
  })

  it('catches checker errors and reports them as violations', async () => {
    const throwingChecker: InvariantChecker = {
      id: 'throws',
      description: 'Throws an error',
      check: async () => {
        throw new Error('boom')
      },
    }

    const report = await runInvariants([throwingChecker], CTX)

    expect(report.ok).toBe(false)
    expect(report.violations[0].message).toContain('boom')
    expect(report.violations[0].severity).toBe('error')
  })
})

describe('noOrphanedJobs checker', () => {
  it('passes when the queue has no jobs', async () => {
    const registry = createJobRegistry()
    const queue = createInMemoryQueue({ registry })
    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)
    expect(violations).toHaveLength(0)
  })

  it('passes when all enqueued jobs were processed', async () => {
    const registry = createJobRegistry()
    registry.register('test-job', async () => {})
    const queue = createInMemoryQueue({ registry })
    await queue.add('test-job', { data: 1 })

    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)
    expect(violations).toHaveLength(0)
  })

  it('reports an unregistered job as an error naming the job', async () => {
    const registry = createJobRegistry()
    const queue = createInMemoryQueue({ registry })
    await queue.add('unknown-job', {})

    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain('no registered handler')
    expect(violations[0].message).toContain('unknown-job')
    expect(violations[0].evidence?.unregisteredByJobName).toEqual({ 'unknown-job': 1 })
  })

  it('reports a throwing handler as an error naming the error, NOT as a missing handler', async () => {
    const registry = createJobRegistry()
    registry.register('exploding-job', async () => {
      throw new Error('column "coalesced_count" does not exist')
    })
    const queue = createInMemoryQueue({ registry })
    await expect(queue.add('exploding-job', {})).rejects.toThrow(/coalesced_count/)

    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain('THREW')
    expect(violations[0].message).toContain('column "coalesced_count" does not exist')
    // The misdiagnosis this replaced: it used to say the handler was missing.
    expect(violations[0].message).not.toContain('no registered handler')
    expect(violations[0].evidence?.failedByJobName).toEqual({ 'exploding-job': 1 })
  })

  it('reports a job enqueued before the registry was connected as a warning', async () => {
    const registry = createJobRegistry()
    registry.register('late-job', async () => {})
    // No registry at enqueue time — the simulation container connects it only
    // after bootstrap, so this job found no handler even though one exists now.
    const queue = createInMemoryQueue()
    await queue.add('late-job', {})
    queue.connectRegistry(registry)

    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
    expect(violations[0].message).toContain('never invoked')
    expect(violations[0].evidence?.undrainedByJobName).toEqual({ 'late-job': 1 })
  })

  it('separates a partially-failing job name into its own report', async () => {
    const registry = createJobRegistry()
    let calls = 0
    registry.register('flaky-job', async () => {
      calls += 1
      if (calls === 1) throw new Error('first call failed')
    })
    const queue = createInMemoryQueue({ registry })
    await expect(queue.add('flaky-job', {})).rejects.toThrow('first call failed')
    await queue.add('flaky-job', {})

    const checker = noOrphanedJobs({ queue, registry })
    const violations = await checker.check(CTX)

    // 2 enqueued, 1 processed, 1 failed: the outstanding one is fully
    // accounted for by the throw, so nothing is reported as unregistered.
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toContain('THREW')
    expect(violations[0].evidence?.failedByJobName).toEqual({ 'flaky-job': 1 })
  })

  it('reports a missing queue as an error instead of silently passing', async () => {
    const checker = noOrphanedJobs({ registry: createJobRegistry() })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain('No queue was injected')
  })

  it('reports a missing registry as an error instead of silently passing', async () => {
    const checker = noOrphanedJobs({ queue: createInMemoryQueue() })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain('No job registry was injected')
  })
})
