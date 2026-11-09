import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { sql } from 'drizzle-orm'
import { borrowReviewTransaction } from './open-transaction'
import { createReviewSourceTransitionAuthority } from './source-transition-authority'

const ORG = organizationId('review-open-transaction-org')
const OTHER_ORG = organizationId('review-open-transaction-other')
const PROPERTY = propertyId(randomUUID())
const REVIEW = reviewId(randomUUID())
const OCCURRED_AT = new Date('2026-08-27T00:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['reviews'],
})

beforeEach(async () => {
  await getPool().query(
    `DELETE FROM reviews WHERE property_id IN (
       SELECT id FROM properties WHERE organization_id = $1 AND slug = 'open-transaction')`,
    [ORG],
  )
  await getPool().query(
    `DELETE FROM properties WHERE organization_id = $1 AND slug = 'open-transaction'`,
    [ORG],
  )
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Open transaction', 'open-transaction', 'UTC', 0)`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, source_epoch,
       source_revision, analysis_sequence, source_content_state,
       source_content_erased_at
     ) VALUES ($1, $2, $3, 'google', 0, 3, 7, 'source_expired', $4)`,
    [REVIEW, ORG, PROPERTY, OCCURRED_AT],
  )
})

describe('Review exact-current authority lends its open transaction', () => {
  it('hands apply a transaction on the backend that holds the Review fence', async () => {
    let lentPid: number | undefined
    let holderPid: number | undefined

    const result = await createReviewSourceTransitionAuthority(getDb()).withExactCurrent(
      {
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: REVIEW,
        sourceEpoch: 0,
        sourceRevision: 3,
        analysisSequence: 7,
        change: 'source_expired',
        occurredAt: OCCURRED_AT,
      },
      async (_permit, tx) => {
        const rows = await borrowReviewTransaction(tx).execute(
          sql`SELECT pg_backend_pid() AS pid`,
        )
        lentPid = Number((rows.rows[0] as { pid: number }).pid)

        const holder = await getPool().query(
          `SELECT l.pid FROM pg_locks l
           JOIN reviews r ON r.xmax::text::bigint = l.transactionid::text::bigint
           WHERE r.id = $1 AND l.locktype = 'transactionid' AND l.granted`,
          [REVIEW],
        )
        holderPid = Number(holder.rows[0]?.pid)
        return 'done'
      },
    )

    expect(result).toEqual({ status: 'current', value: 'done' })
    expect(lentPid).toBeGreaterThan(0)
    expect(holderPid).toBe(lentPid)
  })
})
