import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createDormantBillingDataLifecycleAdapter } from './dormant-billing-data-lifecycle.adapter'

const ORG_A = 'dormant-billing-lifecycle-a'
const ORG_B = 'dormant-billing-lifecycle-b'

type PriorRow = Readonly<{
  id: string
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
}>

let lease: TestLease
let db: Database

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('dormant Billing data lifecycle (real PostgreSQL)', () => {
  it('reports, drift-refuses, erases, and verifies the five compatibility fields', async () => {
    const prior = await lease.pool.query<PriorRow>(`
      SELECT id,
             "billingCompanyName",
             "billingAddress",
             "billingCity",
             "billingPostalCode",
             "billingCountry"
      FROM organization
      WHERE "billingCompanyName" IS NOT NULL
         OR "billingAddress" IS NOT NULL
         OR "billingCity" IS NOT NULL
         OR "billingPostalCode" IS NOT NULL
         OR "billingCountry" IS NOT NULL
    `)
    try {
      await lease.pool.query(`
        UPDATE organization
        SET "billingCompanyName" = NULL,
            "billingAddress" = NULL,
            "billingCity" = NULL,
            "billingPostalCode" = NULL,
            "billingCountry" = NULL
      `)
      await deleteTestOrganizations(lease.pool, [ORG_A, ORG_B])
      await lease.pool.query(
        `INSERT INTO organization (
           id, name, slug, "createdAt", "billingCompanyName", "billingAddress",
           "billingCity", "billingPostalCode", "billingCountry"
         ) VALUES
           ($1, 'Dormant Billing A', $1, now(), 'Dormant Ltd', 'One Street', NULL, NULL, 'BG'),
           ($2, 'Dormant Billing B', $2, now(), NULL, NULL, 'Sofia', '1000', NULL)`,
        [ORG_A, ORG_B],
      )

      const adapter = createDormantBillingDataLifecycleAdapter(db)
      const report = await adapter.report(new Date('2026-08-28T00:00:00.000Z'))
      expect(report).toMatchObject({
        organizationsWithDormantBillingData: 2,
        storedFieldValueCount: 5,
        fieldPresenceCounts: {
          billingCompanyName: 1,
          billingAddress: 1,
          billingCity: 1,
          billingPostalCode: 1,
          billingCountry: 1,
        },
      })

      await expect(
        adapter.erase({
          expectedTargetFingerprint: '0'.repeat(64),
          evaluatedAt: new Date('2026-08-28T00:00:01.000Z'),
        }),
      ).resolves.toMatchObject({ status: 'refused_fingerprint' })

      const erased = await adapter.erase({
        expectedTargetFingerprint: report.targetFingerprint,
        evaluatedAt: new Date('2026-08-28T00:00:02.000Z'),
      })
      expect(erased).toMatchObject({
        status: 'erased',
        erasedOrganizationCount: 2,
        erasedFieldValueCount: 5,
        after: { erasureRequired: false },
      })
      const after = await adapter.report(new Date('2026-08-28T00:00:03.000Z'))
      expect(after).toMatchObject({
        organizationsWithDormantBillingData: 0,
        storedFieldValueCount: 0,
      })
      await expect(
        adapter.erase({
          expectedTargetFingerprint: after.targetFingerprint,
          evaluatedAt: new Date('2026-08-28T00:00:04.000Z'),
        }),
      ).resolves.toMatchObject({ status: 'no_data' })
    } finally {
      await deleteTestOrganizations(lease.pool, [ORG_A, ORG_B])
      for (const row of prior.rows) {
        await lease.pool.query(
          `UPDATE organization
           SET "billingCompanyName" = $2,
               "billingAddress" = $3,
               "billingCity" = $4,
               "billingPostalCode" = $5,
               "billingCountry" = $6
           WHERE id = $1`,
          [
            row.id,
            row.billingCompanyName,
            row.billingAddress,
            row.billingCity,
            row.billingPostalCode,
            row.billingCountry,
          ],
        )
      }
    }
  })
})
