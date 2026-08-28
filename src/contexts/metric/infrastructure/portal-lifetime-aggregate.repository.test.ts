import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { createPortalLifetimeAggregateRepository } from './repositories/portal-lifetime-aggregate.repository'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'

const SCOPE = {
  organizationId: organizationId('org-lifetime'),
  propertyId: propertyId('a1000000-0000-4000-8000-000000000001'),
  portalId: portalId('a2000000-0000-4000-8000-000000000001'),
}
const NOW = new Date('2026-08-27T12:00:00.000Z')

const storedRow = (overrides: Record<string, unknown> = {}) => ({
  qualifiedScanCount: 10,
  privateRatingCount: 2,
  privateRatingSum: 7,
  privateRating1Count: 0,
  privateRating2Count: 0,
  privateRating3Count: 1,
  privateRating4Count: 1,
  privateRating5Count: 0,
  privateFeedbackCount: 1,
  googleReviewSelectionCount: 2,
  secondaryLinkSelectionCount: 3,
  sealedQualifiedScanCount: 4,
  sealedPrivateRatingCount: 1,
  sealedPrivateRatingSum: 3,
  sealedPrivateRating1Count: 0,
  sealedPrivateRating2Count: 0,
  sealedPrivateRating3Count: 1,
  sealedPrivateRating4Count: 0,
  sealedPrivateRating5Count: 0,
  sealedPrivateFeedbackCount: 0,
  sealedGoogleReviewSelectionCount: 1,
  sealedSecondaryLinkSelectionCount: 1,
  sealedThroughLocalDate: '2026-07-01',
  projectionRevision: 5,
  lastRebuiltAt: null,
  lastSealedAt: null,
  ...overrides,
})

const aggregateRow = (overrides: Record<string, unknown> = {}) => ({
  qualifiedScanCount: 6,
  privateRatingCount: 1,
  privateRatingSum: 4,
  privateRating1Count: 0,
  privateRating2Count: 0,
  privateRating3Count: 0,
  privateRating4Count: 1,
  privateRating5Count: 0,
  privateFeedbackCount: 1,
  googleReviewSelectionCount: 1,
  secondaryLinkSelectionCount: 2,
  invalidFactCount: 0,
  ...overrides,
})

function compile(fragment: unknown): string {
  return new PgDialect().sqlToQuery(fragment as SQL).sql
}

function params(fragment: unknown): readonly unknown[] {
  return new PgDialect().sqlToQuery(fragment as SQL).params
}

describe('createPortalLifetimeAggregateRepository', () => {
  it('exposes the immutable governed versions represented by the lifetime row', async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [storedRow()] })),
    } as unknown as Database

    const result = await createPortalLifetimeAggregateRepository(db, () => NOW).get(SCOPE)

    expect(result?.definitionVersionIds).toEqual({
      qualifiedScans: METRIC_VERSION_IDS.qualifiedScanGoal,
      privateRatings: METRIC_VERSION_IDS.portalRatingAnalytics,
      privateFeedback: METRIC_VERSION_IDS.portalFeedbackAnalytics,
      destinationSelections: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    })
  })

  it('rebuilds retained facts on top of the anonymous sealed baseline', async () => {
    const queries: unknown[] = []
    let call = 0
    const tx = {
      execute: vi.fn(async (query: unknown) => {
        queries.push(query)
        call += 1
        if (call === 2) return { rows: [storedRow()] }
        if (call === 3) return { rows: [aggregateRow()] }
        return { rows: [] }
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    const result = await createPortalLifetimeAggregateRepository(db, () => NOW).rebuild(
      SCOPE,
    )

    expect(result.after.values).toMatchObject({
      qualifiedScanCount: 10,
      privateRatingCount: 2,
      privateRatingSum: 7,
      privateRating3Count: 1,
      privateRating4Count: 1,
      googleReviewSelectionCount: 2,
      secondaryLinkSelectionCount: 3,
    })
    expect(result.matched).toBe(true)
    const rebuildSql = compile(queries[2])
    expect(rebuildSql).toContain('metric_corrections')
    expect(rebuildSql).toContain('supersedes_correction_id')
    expect(rebuildSql).toContain('portal_destination_kind')
    expect(rebuildSql).toContain('property_local_date >=')
    expect(params(queries[2])).toEqual(
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111301',
        '11111111-1111-4111-8111-111111111202',
      ]),
    )
    expect(rebuildSql).not.toContain('property.review')
  })

  it('inspects canonical parity without writing or advancing operational state', async () => {
    let call = 0
    const tx = {
      execute: vi.fn(async () => {
        call += 1
        if (call === 2) return { rows: [storedRow()] }
        if (call === 3) {
          return {
            rows: [aggregateRow({ qualifiedScanCount: 5 })],
          }
        }
        return { rows: [] }
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    const result = await createPortalLifetimeAggregateRepository(db, () => NOW).inspect(
      SCOPE,
    )

    expect(result.matched).toBe(false)
    expect(result.current.values.qualifiedScanCount).toBe(10)
    expect(result.expectedValues.qualifiedScanCount).toBe(9)
    expect(result.current.projectionRevision).toBe(5)
    expect(tx.execute).toHaveBeenCalledTimes(3)
  })

  it('fails closed instead of blessing malformed effective facts', async () => {
    let call = 0
    const tx = {
      execute: vi.fn(async () => {
        call += 1
        if (call === 2) return { rows: [storedRow()] }
        if (call === 3) return { rows: [aggregateRow({ invalidFactCount: 1 })] }
        return { rows: [] }
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    await expect(
      createPortalLifetimeAggregateRepository(db, () => NOW).rebuild(SCOPE),
    ).rejects.toThrow('invalid governed Portal lifetime fact')
    expect(tx.execute).toHaveBeenCalledTimes(3)
  })

  it('seals only the newly expiring interval and rebuilds the retained side', async () => {
    const queries: unknown[] = []
    let call = 0
    const tx = {
      execute: vi.fn(async (query: unknown) => {
        queries.push(query)
        call += 1
        if (call === 2) return { rows: [storedRow()] }
        if (call === 3) {
          return {
            rows: [
              aggregateRow({
                qualifiedScanCount: 2,
                privateRatingCount: 0,
                privateRatingSum: 0,
                privateRating3Count: 0,
                privateRating4Count: 0,
                privateFeedbackCount: 0,
                googleReviewSelectionCount: 0,
                secondaryLinkSelectionCount: 0,
              }),
            ],
          }
        }
        if (call === 4) return { rows: [aggregateRow()] }
        return { rows: [] }
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    const result = await createPortalLifetimeAggregateRepository(
      db,
      () => NOW,
    ).sealThrough(SCOPE, '2026-08-01')

    expect(result.after.sealedThroughLocalDate).toBe('2026-08-01')
    expect(result.after.values.qualifiedScanCount).toBe(12)
    expect(compile(queries[2])).toContain('property_local_date <')
    expect(compile(queries[3])).toContain('property_local_date >=')
  })

  it('rejects a backwards or malformed retention boundary before writing', async () => {
    let call = 0
    const tx = {
      execute: vi.fn(async () => {
        call += 1
        return call === 2 ? { rows: [storedRow()] } : { rows: [] }
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database
    const repo = createPortalLifetimeAggregateRepository(db, () => NOW)

    await expect(repo.sealThrough(SCOPE, '2026-06-30')).rejects.toThrow(
      'cannot move backwards',
    )
    await expect(repo.sealThrough(SCOPE, 'not-a-date')).rejects.toThrow('invalid')
  })
})
