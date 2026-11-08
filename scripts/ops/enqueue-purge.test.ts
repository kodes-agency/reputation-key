import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION } from '../../src/contexts/review/application/use-cases/run-source-content-lifecycle'
import { main } from './enqueue-purge'

const fakes = vi.hoisted(() => ({
  dryRun: true,
  runLifecycle: vi.fn(),
  add: vi.fn(async () => ({ id: 'queued-job' })),
  close: vi.fn(),
  out: vi.fn(),
  err: vi.fn(),
  execute: vi.fn(async () => ({ rows: [{ count: 2 }] })),
}))

vi.mock('../../src/contexts/review/build', () => ({
  wireReviewSourceContentLifecycle: () => fakes.runLifecycle,
}))
vi.mock('../../src/shared/db', () => ({ getDb: () => ({ execute: fakes.execute }) }))
vi.mock('../../src/shared/jobs/retention-sweep.job', () => ({
  GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT: 'import',
}))
vi.mock('../../src/composition/retention-rules', () => ({
  RETENTION_RULES: [
    {
      subject: 'audit_events',
      table: 'audit_events',
      keyColumns: ['id'],
      tsColumn: 'occurred_at',
      olderThanMs: 365 * 86400000,
    },
  ],
}))
vi.mock('../../src/shared/jobs/queue', () => ({
  createJobQueue: () => ({ add: fakes.add, close: fakes.close }),
}))
vi.mock('../../src/shared/jobs/job-policy', () => ({ jobEnqueueOptions: () => ({}) }))
vi.mock('./operator-command', () => ({
  runOperatorCommand: async (
    _spec: unknown,
    action: (ctx: unknown, args: string[], io: unknown) => Promise<number | void>,
  ) => ({
    exitCode:
      (await action({ dryRun: fakes.dryRun }, [], { out: fakes.out, err: fakes.err })) ??
      0,
  }),
}))

describe('purge operator command', () => {
  const originalArgv = process.argv
  beforeEach(() => {
    vi.clearAllMocks()
    fakes.dryRun = true
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })
  afterEach(() => {
    process.argv = originalArgv
    vi.restoreAllMocks()
  })

  it('collects every shadow page without enqueueing or applying', async () => {
    process.argv = [
      'node',
      'enqueue-purge.ts',
      'reviews-shadow',
      '--operator',
      'operator',
    ]
    const checkpoint = {
      contract: 'review-source-content-lifecycle-v1',
      mode: 'shadow',
      scope: { kind: 'expired' },
      evaluatedAt: '2026-11-08T00:00:00.000Z',
      after: {
        createdAt: '2026-10-01T00:00:00.000Z',
        reviewId: '00000000-0000-4000-8000-000000000001',
      },
    }
    const page = {
      mode: 'shadow',
      scope: checkpoint.scope,
      evaluatedAt: checkpoint.evaluatedAt,
      scanned: 1,
      lifecycle: { eligible: 0, expired: 1, tombstone: 0, unverifiable: 0 },
      shadow: { matched: 1, drifted: 0, findingCounts: {} },
    }
    fakes.runLifecycle
      .mockResolvedValueOnce({ ...page, nextCheckpoint: checkpoint })
      .mockResolvedValueOnce({ ...page, nextCheckpoint: null })

    await main()

    expect(fakes.runLifecycle).toHaveBeenNthCalledWith(2, {
      mode: 'shadow',
      batchSize: 100,
      checkpoint,
    })
    expect(JSON.parse(fakes.out.mock.calls[0]![0])).toMatchObject({
      pages: 2,
      scanned: 2,
      shadow: { matched: 2, drifted: 0 },
    })
    expect(fakes.add).not.toHaveBeenCalled()
  })

  it('queues an explicit expiry apply request rather than silently queueing a report', async () => {
    fakes.dryRun = false
    process.argv = [
      'node',
      'enqueue-purge.ts',
      'reviews',
      '--operator',
      'operator',
      '--apply',
      '--yes',
      'ops:purge',
    ]

    await main()

    expect(fakes.add).toHaveBeenCalledWith(
      'purge-expired-reviews',
      {
        mode: 'apply',
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      },
      {},
    )
    expect(fakes.runLifecycle).not.toHaveBeenCalled()
    expect(fakes.close).toHaveBeenCalledOnce()
  })

  it('refuses apply on the shadow target', async () => {
    fakes.dryRun = false
    process.argv = [
      'node',
      'enqueue-purge.ts',
      'reviews-shadow',
      '--operator',
      'operator',
      '--apply',
      '--yes',
      'ops:purge',
    ]

    await main()

    expect(fakes.add).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('refuses retention apply while scheduled retention ships inactive', async () => {
    fakes.dryRun = false
    process.argv = [
      'node',
      'enqueue-purge.ts',
      'retention',
      '--operator',
      'operator',
      '--apply',
      '--yes',
      'ops:purge',
    ]
    await main()
    expect(fakes.add).not.toHaveBeenCalled()
    expect(fakes.err).toHaveBeenCalledWith(expect.stringMatching(/retention is inactive/))
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('keeps the composed-registry trial available while apply is inactive', async () => {
    process.argv = ['node', 'enqueue-purge.ts', 'retention', '--operator', 'operator']
    await main()
    expect(JSON.parse(fakes.out.mock.calls[0]![0])).toMatchObject({
      mode: 'report',
      scheduledApplyActive: false,
      totalEligibleRows: 2,
      rules: [{ subject: 'audit_events', eligibleRows: 2 }],
    })
    expect(fakes.execute).toHaveBeenCalledOnce()
    expect(fakes.add).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
  })
})
