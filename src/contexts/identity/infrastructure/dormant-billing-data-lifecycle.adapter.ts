import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  buildDormantBillingDataReport,
  type DormantBillingDataReport,
  type DormantBillingPresenceRow,
} from '../application/dormant-billing-data-lifecycle'

type Row = Readonly<Record<string, unknown>>

const PRESENCE_SELECT = `
SELECT id::text AS organization_id,
       ("billingCompanyName" IS NOT NULL) AS billing_company_name_present,
       ("billingAddress" IS NOT NULL) AS billing_address_present,
       ("billingCity" IS NOT NULL) AS billing_city_present,
       ("billingPostalCode" IS NOT NULL) AS billing_postal_code_present,
       ("billingCountry" IS NOT NULL) AS billing_country_present
FROM organization
ORDER BY id
`

const READ_PRESENCE = sql.raw(PRESENCE_SELECT)
const READ_PRESENCE_FOR_UPDATE = sql.raw(`${PRESENCE_SELECT.trimEnd()} FOR UPDATE`)

const ERASE_DORMANT_BILLING = sql.raw(`
UPDATE organization
SET "billingCompanyName" = NULL,
    "billingAddress" = NULL,
    "billingCity" = NULL,
    "billingPostalCode" = NULL,
    "billingCountry" = NULL
WHERE "billingCompanyName" IS NOT NULL
   OR "billingAddress" IS NOT NULL
   OR "billingCity" IS NOT NULL
   OR "billingPostalCode" IS NOT NULL
   OR "billingCountry" IS NOT NULL
RETURNING id::text AS organization_id
`)

const booleanField = (row: Row, field: string): boolean => {
  const value = row[field]
  if (typeof value !== 'boolean') throw new Error('dormant_billing_snapshot_invalid')
  return value
}

const presenceRow = (row: Row): DormantBillingPresenceRow => {
  const organizationId = row.organization_id
  if (typeof organizationId !== 'string') {
    throw new Error('dormant_billing_snapshot_invalid')
  }
  return {
    organizationId,
    fields: {
      billingCompanyName: booleanField(row, 'billing_company_name_present'),
      billingAddress: booleanField(row, 'billing_address_present'),
      billingCity: booleanField(row, 'billing_city_present'),
      billingPostalCode: booleanField(row, 'billing_postal_code_present'),
      billingCountry: booleanField(row, 'billing_country_present'),
    },
  }
}

export type DormantBillingDataErasureOutcome =
  | Readonly<{
      status: 'refused_fingerprint'
      current: DormantBillingDataReport
    }>
  | Readonly<{
      status: 'no_data'
      report: DormantBillingDataReport
    }>
  | Readonly<{
      status: 'erased'
      erasedOrganizationCount: number
      erasedFieldValueCount: number
      before: DormantBillingDataReport
      after: DormantBillingDataReport
    }>

export type DormantBillingDataLifecycleAdapter = Readonly<{
  report(evaluatedAt: Date): Promise<DormantBillingDataReport>
  erase(
    input: Readonly<{
      expectedTargetFingerprint: string
      evaluatedAt: Date
    }>,
  ): Promise<DormantBillingDataErasureOutcome>
}>

export const createDormantBillingDataLifecycleAdapter = (
  db: Database,
): DormantBillingDataLifecycleAdapter => ({
  report: (evaluatedAt) =>
    db.transaction(
      async (snapshot) => {
        const result = await snapshot.execute(READ_PRESENCE)
        return buildDormantBillingDataReport({
          evaluatedAt,
          rows: result.rows.map((row) => presenceRow(row as Row)),
        })
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ),
  erase: async ({ expectedTargetFingerprint, evaluatedAt }) => {
    if (!/^[0-9a-f]{64}$/u.test(expectedTargetFingerprint)) {
      throw new Error('dormant_billing_target_fingerprint_invalid')
    }
    return db.transaction(
      async (transaction) => {
        const locked = await transaction.execute(READ_PRESENCE_FOR_UPDATE)
        const before = buildDormantBillingDataReport({
          evaluatedAt,
          rows: locked.rows.map((row) => presenceRow(row as Row)),
        })
        if (before.targetFingerprint !== expectedTargetFingerprint) {
          return { status: 'refused_fingerprint' as const, current: before }
        }
        if (!before.erasureRequired) {
          return { status: 'no_data' as const, report: before }
        }

        const erased = await transaction.execute(ERASE_DORMANT_BILLING)
        if (erased.rows.length !== before.organizationsWithDormantBillingData) {
          throw new Error('dormant_billing_erasure_count_mismatch')
        }
        const verified = await transaction.execute(READ_PRESENCE)
        const after = buildDormantBillingDataReport({
          evaluatedAt,
          rows: verified.rows.map((row) => presenceRow(row as Row)),
        })
        if (after.erasureRequired) {
          throw new Error('dormant_billing_erasure_verification_failed')
        }
        return {
          status: 'erased' as const,
          erasedOrganizationCount: before.organizationsWithDormantBillingData,
          erasedFieldValueCount: before.storedFieldValueCount,
          before,
          after,
        }
      },
      { isolationLevel: 'serializable' },
    )
  },
})
