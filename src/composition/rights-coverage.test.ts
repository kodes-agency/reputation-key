// Joins the data-fate authority to the table lists of the composed rights
// executors. A table the authority records that no executor covers must be
// named below, with the reason; a named table that an executor starts to cover
// fails until it is removed, so the lists show exactly what remains.

import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_RIGHTS_TABLES } from '#/contexts/feed/application/public-api'
import { notificationPurgeTables } from '#/contexts/feed/rights/purge.server'
import type { Database } from '#/shared/db'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { composeRightsExecutors } from './rights-executors'

/** Tables that wait for the Property, identity or participant executor. */
const OWNER_DECISION_TABLES = [
  'account',
  'backup_erasure_ledger',
  'beta_feedback_masked_layouts',
  'beta_feedback_triage',
  'beta_feedback_triage_transitions',
  'invitation',
  'member',
  'merchant_ai_notice_update_receipts',
  'organization',
  'organizationRole',
  'organization_export_retrieval_issuances',
  'organization_exports',
  'organization_lifecycle_authority',
  'organization_role_policy',
  'permission_version',
  'policy_consent',
  'portal_group_memberships',
  'portal_responsibilities',
  'privacy_requests',
  'product_update_receipts',
  'product_update_settings',
  'properties',
  'property_access_grant',
  'property_access_grants',
  'property_erase_authorities',
  'property_responsible_managers',
  'session',
  'staff_onboardings',
  'staff_participants',
  'staff_participations',
  'staff_property_settings',
  'staff_user_links',
  'user',
  'verification',
]

/** Retained on purpose: the owning lifecycle keeps them or removes them by cascade. */
const RETAINED_TABLES = [
  // Append-only consent proof; a guard trigger refuses its deletion.
  'merchant_ai_consent_evidence',
  // Removed through the schema's cascade when the Property rows go.
  'merchant_ai_enablement',
  // Content-free proof that a named manager authorized one publication cycle.
  'reply_publication_authorizations',
]

/** Held by no executor yet and not waiting on an owner decision. */
const UNCOVERED_TABLES = [
  'ai_execution_control_heads',
  'ai_execution_control_transitions',
  'ai_property_trend_scheduler_heads',
  'audit_events',
  'audit_logs',
  'capability_execution_control',
  'event_consumer_receipts',
  'merchant_ai_decision_deferrals',
  'notification_email_suppressions',
  'operational_action_history_heads',
  'operational_action_history_legal_holds',
  'operational_action_history_records',
  'organization_lifecycle_events',
  'outbox_events',
  'recovery_runs',
  'reply_ai_frame_reservations',
  'retention_runs',
  'review_lifecycle_recovery_executions',
  'review_provider_subject_hmac_key_versions',
  'review_refresh_runs',
  'work_items',
]

/** Covered for an Organization but not for one Property that holds rows in them. */
const ORGANIZATION_ONLY_COVERAGE = ['authorization_execution_permits']

const KNOWN_GAPS = new Set([
  ...OWNER_DECISION_TABLES,
  ...RETAINED_TABLES,
  ...UNCOVERED_TABLES,
])

const SCHEMA_MODULES = import.meta.glob<Record<string, unknown>>(
  ['../shared/db/schema/*.ts', '!../shared/db/schema/*.test.ts'],
  { eager: true },
)

type SchemaTable = Readonly<{
  name: string
  hasOrganization: boolean
  hasProperty: boolean
}>

function schemaTables() {
  const tables = new Map<string, PgTable>()
  const byKey = new Map<string, PgTable>()
  for (const [path, module] of Object.entries(SCHEMA_MODULES)) {
    const file = path.slice(path.lastIndexOf('/') + 1)
    for (const [exportName, value] of Object.entries(module)) {
      if (!isTable(value)) continue
      tables.set(getTableName(value), value as PgTable)
      byKey.set(`${file}#${exportName}`, value as PgTable)
    }
  }
  return { tables, byKey }
}

const { tables: ALL_TABLES, byKey: TABLES_BY_KEY } = schemaTables()

function describeTable(table: PgTable): SchemaTable {
  const columns = Object.values(getTableColumns(table)).map((column) => column.name)
  return {
    name: getTableName(table),
    hasOrganization: columns.includes('organization_id'),
    hasProperty: columns.includes('property_id'),
  }
}

const FATE_TABLES: ReadonlyArray<SchemaTable> = DATA_FATE_AUTHORITY.map((row) => {
  const table = TABLES_BY_KEY.get(`${row.schemaFile}#${row.exportName}`)
  if (!table) throw new Error(`no table exported as ${row.schemaFile}#${row.exportName}`)
  return describeTable(table)
})

const EXECUTORS: ReadonlyArray<RightsExecutor> = composeRightsExecutors(
  {
    db: {} as Database,
    runNotification: vi.fn(),
    portalObjectStore: { deleteObject: vi.fn() },
  },
  false,
)

function covered(scope: 'organization' | 'property'): ReadonlySet<string> {
  return new Set(EXECUTORS.flatMap((executor) => executor.tables[scope]))
}

/** Tables whose rows an ON DELETE CASCADE removes with a row of the parent. */
function cascadeChildren(): ReadonlyMap<string, ReadonlyArray<string>> {
  const children = new Map<string, string[]>()
  for (const [name, table] of ALL_TABLES) {
    for (const foreignKey of getTableConfig(table).foreignKeys) {
      if (foreignKey.onDelete !== 'cascade') continue
      const parent = getTableName(foreignKey.reference().foreignTable)
      children.set(parent, [...(children.get(parent) ?? []), name])
    }
  }
  return children
}

function cascadeClosure(roots: ReadonlyArray<string>): ReadonlySet<string> {
  const children = cascadeChildren()
  const seen = new Set<string>()
  const pending = [...roots]
  for (let table = pending.pop(); table !== undefined; table = pending.pop()) {
    for (const child of children.get(table) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      pending.push(child)
    }
  }
  return seen
}

describe('rights coverage', () => {
  it('composes every executor with a table list under known tables', () => {
    for (const executor of EXECUTORS) {
      for (const scope of ['organization', 'property'] as const) {
        expect(
          executor.tables[scope].length,
          `${executor.name}/${scope}`,
        ).toBeGreaterThan(0)
        const unknown = executor.tables[scope].filter((table) => !ALL_TABLES.has(table))
        expect(unknown, `${executor.name}/${scope}`).toEqual([])
      }
    }
  })

  it('covers every table the authority records for an Organization, or names it as a gap', () => {
    const organization = covered('organization')
    const unnamed = FATE_TABLES.filter(
      ({ name }) => !organization.has(name) && !KNOWN_GAPS.has(name),
    ).map(({ name }) => name)
    expect(unnamed).toEqual([])
  })

  it('names no gap that an executor already covers or the authority does not record', () => {
    const organization = covered('organization')
    const recorded = new Set(FATE_TABLES.map(({ name }) => name))
    expect([...KNOWN_GAPS].filter((name) => organization.has(name))).toEqual([])
    expect([...KNOWN_GAPS].filter((name) => !recorded.has(name))).toEqual([])
  })

  it('covers every Organization table that holds Property rows for a Property request', () => {
    const organization = covered('organization')
    const property = covered('property')
    const missing = FATE_TABLES.filter(
      ({ name, hasProperty }) =>
        hasProperty && organization.has(name) && !property.has(name),
    ).map(({ name }) => name)
    expect(missing.filter((name) => !ORGANIZATION_ONLY_COVERAGE.includes(name))).toEqual(
      [],
    )
    expect(
      ORGANIZATION_ONLY_COVERAGE.filter((name) => property.has(name)),
      'listed as organization-only but a Property request covers it',
    ).toEqual([])
  })

  it('lists every table a delete reaches by cascade, so a report sizes the closure', () => {
    for (const scope of ['organization', 'property'] as const) {
      const union = covered(scope)
      for (const executor of EXECUTORS) {
        const scrubbed = new Set(executor.tables.scrubbed ?? [])
        const deleted = executor.tables[scope].filter((table) => !scrubbed.has(table))
        const missing = [...cascadeClosure(deleted)].filter((table) => !union.has(table))
        expect(missing, `${executor.name}/${scope}`).toEqual([])
      }
    }
  })

  it('declares the notification tables its purge steps delete from', () => {
    for (const scope of ['organization', 'property'] as const) {
      expect(notificationPurgeTables(scope)).toEqual(NOTIFICATION_RIGHTS_TABLES[scope])
    }
  })
})
