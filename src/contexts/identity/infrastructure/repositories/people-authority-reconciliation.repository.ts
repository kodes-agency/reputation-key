import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  buildPeopleAuthorityReconciliationReport,
  type PeopleAuthorityReconciliationDimension,
  type PeopleAuthorityReconciliationOutcome,
  type PeopleAuthorityReconciliationRow,
  type PeopleAuthorityReconciliationSource,
} from '../../application/people-authority-reconciliation.server'
import { canonicalPeopleAuthorityRowsSql } from './people-authority-reconciliation.canonical-query'
import { legacyPeopleAuthorityRowsSql } from './people-authority-reconciliation.legacy-query'
import { managerPeopleAuthorityRowsSql } from './people-authority-reconciliation.manager-query'
import { membershipPeopleAuthorityRowsSql } from './people-authority-reconciliation.membership-query'

type RawRow = Readonly<{
  source: string
  sourceId: string
  dimension: string
  outcome: string
  organizationId: string
  propertyId: string | null
  portalId: string | null
  userId: string | null
  reasonCode: string
  relatedIds: string[] | null
}>

const SOURCES = new Set<PeopleAuthorityReconciliationSource>([
  'legacy_staff_assignment',
  'legacy_property_access_grant',
  'property_access_grant',
  'organization_membership',
  'staff_participant',
  'staff_participation',
  'staff_user_link',
  'portal_responsibility',
  'team_membership',
  'portal_responsible_manager',
  'property_responsible_manager',
])
const DIMENSIONS = new Set<PeopleAuthorityReconciliationDimension>([
  'participant_mapping',
  'staff_attribution_mapping',
  'access_mapping',
  'membership_eligibility',
  'participant_integrity',
  'participation_integrity',
  'login_link_integrity',
  'compatibility_user_shadow',
  'staff_attribution_integrity',
  'manager_eligibility',
  'team_quarantine',
  'retained_history',
])
const OUTCOMES = new Set<PeopleAuthorityReconciliationOutcome>([
  'exact',
  'mappable',
  'conflict',
  'orphan',
  'unsafe',
])

function checkedRow(row: RawRow): PeopleAuthorityReconciliationRow {
  if (!SOURCES.has(row.source as PeopleAuthorityReconciliationSource)) {
    throw new Error(`unknown people reconciliation source: ${row.source}`)
  }
  if (!DIMENSIONS.has(row.dimension as PeopleAuthorityReconciliationDimension)) {
    throw new Error(`unknown people reconciliation dimension: ${row.dimension}`)
  }
  if (!OUTCOMES.has(row.outcome as PeopleAuthorityReconciliationOutcome)) {
    throw new Error(`unknown people reconciliation outcome: ${row.outcome}`)
  }
  return {
    source: row.source as PeopleAuthorityReconciliationSource,
    sourceId: row.sourceId,
    dimension: row.dimension as PeopleAuthorityReconciliationDimension,
    outcome: row.outcome as PeopleAuthorityReconciliationOutcome,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    userId: row.userId,
    reasonCode: row.reasonCode,
    relatedIds: row.relatedIds ?? [],
  }
}

export async function buildPeopleAuthorityReconciliationReportFromDatabase(
  db: Database,
  input: Readonly<{ asOf: Date; organizationIds?: readonly string[] }>,
) {
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  const scopePredicate = organizationIds.length
    ? sql`observations."organizationId" IN (${sql.join(
        organizationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql`TRUE`
  const result = await db.execute(sql`
    WITH observations AS (
      ${legacyPeopleAuthorityRowsSql(input.asOf)}
      UNION ALL
      ${canonicalPeopleAuthorityRowsSql(input.asOf)}
      UNION ALL
      ${membershipPeopleAuthorityRowsSql()}
      UNION ALL
      ${managerPeopleAuthorityRowsSql(input.asOf)}
    )
    SELECT "source", "sourceId", "dimension", "outcome",
           "organizationId", "propertyId", "portalId", "userId",
           "reasonCode", "relatedIds"
    FROM observations
    WHERE ${scopePredicate}
    ORDER BY "organizationId", "source", "sourceId", "dimension"
  `)
  return buildPeopleAuthorityReconciliationReport({
    asOf: input.asOf,
    organizationIds,
    rows: (result.rows as unknown as readonly RawRow[]).map(checkedRow),
  })
}
