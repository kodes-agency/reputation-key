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
    const queue = createInMemoryQueue()
    const checker = noOrphanedJobs({ queue })
    const violations = await checker.check(CTX)
    expect(violations).toHaveLength(0)
  })

  it('passes when all enqueued jobs were processed', async () => {
    const registry = createJobRegistry()
    registry.register('test-job', async () => {})
    const queue = createInMemoryQueue({ registry })
    await queue.add('test-job', { data: 1 })

    const checker = noOrphanedJobs({ queue })
    const violations = await checker.check(CTX)
    expect(violations).toHaveLength(0)
  })

  it('reports orphaned jobs (enqueued without a handler)', async () => {
    const queue = createInMemoryQueue()
    await queue.add('unknown-job', {})

    const checker = noOrphanedJobs({ queue })
    const violations = await checker.check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
    expect(violations[0].evidence?.totalEnqueued).toBe(1)
    expect(violations[0].evidence?.totalProcessed).toBe(0)
  })

  it('passes when no queue is provided', async () => {
    const checker = noOrphanedJobs({})
    const violations = await checker.check(CTX)
    expect(violations).toHaveLength(0)
  })
})
