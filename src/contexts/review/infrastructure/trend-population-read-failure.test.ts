// What the trend population read says when the database refuses it.
//
// The read answers `policy_unavailable` for any database error, on purpose: its
// callers retry, and the insights reader shows "preparing" (review CONTEXT.md,
// Source content). That answer carried no cause, so on 2026-10-27 a refusal that
// recurred on every attempt read as an unreadable policy until someone found
// the SQLSTATE in the database log. The repository now logs one warning with the
// error's name and its SQLSTATE and nothing else, and still answers the same.

import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createReviewRepository } from './repositories/review.repository'
import {
  logTrendPopulationReadFailure,
  TREND_POPULATION_READ_FAILED,
} from './trend-population-read-failure'

const LOG_MESSAGE = 'The Property trend population could not be read'

/** The error node-postgres raises for a refusal from the server. */
function driverRefusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'error', code, severity: 'ERROR' })
}

/**
 * What drizzle throws: the driver's error under a message that holds the SQL and
 * its values. It keeps the name `Error`, so the SQLSTATE is the signal.
 */
function drizzleFailure(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError(
    'select ai_property_local_date_v1(reviewed_at, $1) from reviews where organization_id = $2',
    ['Europe/Sofia', 'org-private-name'],
    cause,
  )
}

describe('logTrendPopulationReadFailure', () => {
  it('logs the error name and the SQLSTATE the driver error carries, and nothing else', () => {
    const warn = vi.fn()
    const failure = drizzleFailure(
      driverRefusal('25000', 'cannot start subtransactions during a parallel operation'),
    )

    logTrendPopulationReadFailure({ warn }, failure)

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      {
        event: TREND_POPULATION_READ_FAILED,
        errorName: 'Error',
        errorCode: '25000',
      },
      LOG_MESSAGE,
    )
  })

  it('names the event review_trend_population_read_failed', () => {
    expect(TREND_POPULATION_READ_FAILED).toBe('review_trend_population_read_failed')
  })

  it('does not log the message, the statement, its values or the stack', () => {
    const warn = vi.fn()
    const failure = drizzleFailure(
      driverRefusal('57014', 'canceling statement due to statement timeout'),
    )

    logTrendPopulationReadFailure({ warn }, failure)

    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('org-private-name')
    expect(logged).not.toContain('Europe/Sofia')
    expect(logged).not.toContain('ai_property_local_date_v1')
    expect(logged).not.toContain('statement timeout')
  })

  it('reads the code from the error itself when nothing wraps it', () => {
    const warn = vi.fn()

    logTrendPopulationReadFailure({ warn }, driverRefusal('40P01', 'deadlock detected'))

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: TREND_POPULATION_READ_FAILED, errorName: 'error', errorCode: '40P01' },
      LOG_MESSAGE,
    )
  })

  it('takes a numeric code, as a socket error can carry', () => {
    const warn = vi.fn()

    logTrendPopulationReadFailure(
      { warn },
      Object.assign(new Error('socket'), { code: 104 }),
    )

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: TREND_POPULATION_READ_FAILED, errorName: 'Error', errorCode: 104 },
      LOG_MESSAGE,
    )
  })

  it('leaves the code out when the error has none', () => {
    const warn = vi.fn()

    logTrendPopulationReadFailure({ warn }, new TypeError('x is not a function'))

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: TREND_POPULATION_READ_FAILED, errorName: 'TypeError' },
      LOG_MESSAGE,
    )
  })

  it('leaves out a code that is not a short identifier, so a message cannot pass as one', () => {
    const warn = vi.fn()

    logTrendPopulationReadFailure(
      { warn },
      Object.assign(new Error('x'), { code: 'reviewer said: not great, not terrible' }),
    )

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: TREND_POPULATION_READ_FAILED, errorName: 'Error' },
      LOG_MESSAGE,
    )
  })

  it('names a thrown value that is not an error by its type', () => {
    const warn = vi.fn()

    logTrendPopulationReadFailure({ warn }, 'a string, not an error')

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: TREND_POPULATION_READ_FAILED, errorName: 'string' },
      LOG_MESSAGE,
    )
  })

  it('does nothing when no logger was given', () => {
    expect(() =>
      logTrendPopulationReadFailure(undefined, new Error('refused')),
    ).not.toThrow()
  })
})

describe('createReviewRepository readTrendPopulation when the database refuses the read', () => {
  const REQUEST = {
    organizationId: organizationId('org-trend-log'),
    propertyId: propertyId('71000000-0000-4000-8000-000000000401'),
    sourceEpoch: 0,
    timezone: 'Europe/Sofia',
    calendarProfileVersion: 'property-calendar-v1',
    startLocalDate: '2026-08-15',
    endLocalDate: '2026-08-16',
    limit: 10,
    detectEvidenceBeforeStart: false,
  } as const

  const repositoryOver = (transaction: () => Promise<never>, warn = vi.fn()) => ({
    warn,
    repository: createReviewRepository(
      { transaction } as unknown as Database,
      () => new Date('2026-10-27T00:00:00Z'),
      { warn },
    ),
  })

  it('still answers policy_unavailable, which its callers retry', async () => {
    const { repository } = repositoryOver(() =>
      Promise.reject(
        drizzleFailure(
          driverRefusal(
            '25000',
            'cannot start subtransactions during a parallel operation',
          ),
        ),
      ),
    )

    await expect(repository.readTrendPopulation(REQUEST)).resolves.toEqual({
      status: 'policy_unavailable',
    })
  })

  it('logs one warning with the error name and the SQLSTATE', async () => {
    const { repository, warn } = repositoryOver(() =>
      Promise.reject(
        drizzleFailure(
          driverRefusal(
            '25000',
            'cannot start subtransactions during a parallel operation',
          ),
        ),
      ),
    )

    await repository.readTrendPopulation(REQUEST)

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'review_trend_population_read_failed',
        errorName: 'Error',
        errorCode: '25000',
      },
      LOG_MESSAGE,
    )
  })

  it('answers policy_unavailable without reading, and without a warning, for a request it refuses', async () => {
    const transaction = vi.fn()
    const warn = vi.fn()
    const repository = createReviewRepository(
      { transaction } as unknown as Database,
      () => new Date('2026-10-27T00:00:00Z'),
      { warn },
    )

    await expect(
      repository.readTrendPopulation({ ...REQUEST, startLocalDate: 'not a date' }),
    ).resolves.toEqual({ status: 'policy_unavailable' })
    expect(transaction).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers the same when no logger was given', async () => {
    const repository = createReviewRepository(
      {
        transaction: () => Promise.reject(new Error('refused')),
      } as unknown as Database,
      () => new Date('2026-10-27T00:00:00Z'),
    )

    await expect(repository.readTrendPopulation(REQUEST)).resolves.toEqual({
      status: 'policy_unavailable',
    })
  })
})
