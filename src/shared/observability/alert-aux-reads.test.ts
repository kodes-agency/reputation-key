// The three auxiliary alert reads degrade one by one, and each says so: a read
// that failed hands its alert `monitorAvailable: false`, never a reading that
// looks healthy. The real SQL is proven against PostgreSQL in
// src/shared/jobs/infrastructure/repositories/alert-injection.test.ts.

import type pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import { createAlertAuxReader } from './alert-aux-reads'
import { ALERT_DEFINITIONS } from './alert-definitions'

type RetentionRow = Readonly<{ subject: string; outcome: string }>

/** A database whose retention_runs read answers `retention`; the other two reads fail. */
function databaseAnswering(
  retention: () => Promise<{ rows: readonly RetentionRow[] }>,
): Database {
  const unavailable = () => Promise.reject(new Error('relation is unavailable'))
  return {
    // The retention read is the reader's first `execute`.
    execute: vi.fn().mockImplementationOnce(retention).mockImplementation(unavailable),
    select: () => ({ from: () => ({ where: unavailable }) }),
  } as unknown as Database
}

function reader(db: Database) {
  const warn = vi.fn()
  const logger = { warn } as unknown as pino.Logger
  return { aux: createAlertAuxReader({ db, logger }), warn }
}

describe('the retention run read', () => {
  it('names the subjects whose latest run failed', async () => {
    const { aux } = reader(
      databaseAnswering(async () => ({
        rows: [
          { subject: 'reviews.purge', outcome: 'failed' },
          { subject: 'guest.feedback', outcome: 'completed' },
        ],
      })),
    )

    expect((await aux.read()).retention).toEqual({
      monitorAvailable: true,
      failedSubjects: ['reviews.purge'],
    })
  })

  it('says the monitor is unavailable when the read fails, and logs why', async () => {
    const failure = new Error('canceling statement due to statement timeout')
    const { aux, warn } = reader(databaseAnswering(() => Promise.reject(failure)))

    expect((await aux.read()).retention).toEqual({
      monitorAvailable: false,
      failedSubjects: [],
    })
    expect(warn).toHaveBeenCalledWith(
      { err: failure },
      '[alert-aux] retention_runs read failed — unavailable fallback',
    )
  })

  it('pages when the read fails: a failed read is not "no failed runs"', async () => {
    const { aux } = reader(
      databaseAnswering(() => Promise.reject(new Error('statement timeout'))),
    )
    const retentionFailure = ALERT_DEFINITIONS.find(
      (definition) => definition.name === 'retention.failure',
    )

    // The alert reads the auxiliary reads only, never the snapshot.
    const event = retentionFailure?.evaluate?.({} as OperationsSnapshot, await aux.read())

    expect(event).toMatchObject({
      name: 'retention.failure',
      severity: 'P1',
      value: -1,
      detail:
        'retention run monitor unavailable — whether the latest sweeps succeeded is unknown',
    })
  })

  it('degrades alone: the other two reads report their own state', async () => {
    const { aux } = reader(databaseAnswering(async () => ({ rows: [] })))

    const observed = await aux.read()

    expect(observed.retention).toEqual({ monitorAvailable: true, failedSubjects: [] })
    expect(observed.betaFeedbackTriage.monitorAvailable).toBe(false)
    expect(observed.reviewAnalysis.monitorAvailable).toBe(false)
  })
})
