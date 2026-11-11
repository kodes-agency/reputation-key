import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import type { RightsRequestScope } from '#/shared/ops/rights/rights-request-command'
import { composeRightsExecutors } from './rights-executors'

type TenantScope = 'organization' | 'property'

const executors = composeRightsExecutors(
  {
    db: {} as Database,
    journal: createRightsJournal(undefined),
    runNotification: vi.fn(),
    portalObjectStore: { deleteObject: vi.fn() },
  },
  false,
)

/** Tables an erasure keeps on purpose, with the reason. */
const RETAINED: Readonly<Record<string, string>> = {
  organization_lifecycle_events: 'lifecycle evidence',
  organization_lifecycle_authority: 'lifecycle authority; erasure requires its state',
  backup_erasure_ledger: 'erasure evidence',
  privacy_requests: 'erasure evidence',
  property_erase_authorities: 'erasure evidence',
  organization_exports: 'export evidence',
  organization_export_retrieval_issuances: 'export evidence',
  merchant_ai_consent_evidence: 'append-only consent proof; a guard refuses deletes',
  merchant_ai_enablement: 'deletable only by the Identity transition function',
  operational_action_history_heads: 'legal-hold evidence, never touched',
  operational_action_history_legal_holds: 'legal-hold evidence, never touched',
  operational_action_history_records: 'legal-hold evidence, never touched',
  reply_publication_authorizations: 'content-free proof of a manager authorization',
}

/**
 * A table holds personal data when it names a person (a user, an actor, an
 * operator, an author or approver, a contact detail) or carries a free-form
 * payload. Tables with none of these hold configuration or counters.
 */
const PERSONAL_COLUMN =
  /^(user_id|actor_id|operator_id|email|display_name|ip_address|name|address|phone|payload|details|.+_user_id|.+_by)$/

/**
 * Personal-data tables that no executor erases yet for a scope. Each name is a
 * real gap: covering it removes it from this list, and a new uncovered table
 * fails the gate until it is covered, retained or named here.
 */
const KNOWN_GAPS: Readonly<Record<TenantScope, ReadonlyArray<string>>> = {
  organization: [
    'audit_events',
    'audit_logs',
    'merchant_ai_decision_deferrals',
    'merchant_ai_notice_update_receipts',
    'outbox_events',
    'policy_consent',
    'product_update_receipts',
    'product_update_settings',
    'properties',
    'property_access_grant',
    'property_access_grants',
    'property_responsible_managers',
    'work_items',
  ],
  property: [
    'audit_events',
    'authorization_execution_permits',
    'outbox_events',
    'portal_group_memberships',
    'portal_responsibilities',
    'staff_onboardings',
    'staff_participations',
    'staff_property_settings',
  ],
}

const COLUMN_FOR: Readonly<Record<TenantScope, string>> = {
  organization: 'organization_id',
  property: 'property_id',
}

const tenantTables = DATA_FATE_AUTHORITY.flatMap((row) => {
  const table = (schema as Record<string, unknown>)[row.exportName]
  if (!isTable(table)) return []
  const columns = Object.values(getTableColumns(table)).map((column) => column.name)
  return [
    {
      name: getTableName(table),
      columns,
      isPersonal: columns.some((column) => PERSONAL_COLUMN.test(column)),
    },
  ]
})

function personalTablesOf(scope: TenantScope) {
  return tenantTables.filter(
    ({ columns, isPersonal }) => isPersonal && columns.includes(COLUMN_FOR[scope]),
  )
}

function declared(scope: RightsRequestScope): ReadonlySet<string> {
  return new Set(executors.flatMap((executor) => executor.tables[scope] ?? []))
}

describe('rights coverage', () => {
  it('declares only tables the data-fate authority knows', () => {
    const known = new Set(tenantTables.map(({ name }) => name))
    const unknown = executors.flatMap((executor) =>
      Object.values(executor.tables)
        .flat()
        .filter((table) => !known.has(table))
        .map((table) => `${executor.name}: ${table}`),
    )

    expect(unknown).toEqual([])
  })

  it('declares tables for every scope an executor erases', () => {
    const missing = executors.flatMap((executor) =>
      executor.scopes
        .filter((scope) => scope !== 'access')
        .filter((scope) => (executor.tables[scope] ?? []).length === 0)
        .map((scope) => `${executor.name}: ${scope}`),
    )

    expect(missing).toEqual([])
  })

  it.each(['organization', 'property'] as const)(
    'covers every %s-scoped personal-data table or names it as a known gap',
    (scope) => {
      const covered = declared(scope)
      const uncovered = personalTablesOf(scope)
        .map(({ name }) => name)
        .filter((name) => !covered.has(name) && !(name in RETAINED))

      expect([...uncovered].sort()).toEqual([...KNOWN_GAPS[scope]])
    },
  )

  it.each(['organization', 'property'] as const)(
    'names only personal-data tables of the %s scope as known gaps',
    (scope) => {
      const personal = new Set(personalTablesOf(scope).map(({ name }) => name))

      expect(KNOWN_GAPS[scope].filter((name) => !personal.has(name))).toEqual([])
    },
  )

  it('keeps no covered or retained table in the known-gap lists', () => {
    for (const scope of ['organization', 'property'] as const) {
      const covered = declared(scope)
      const stale = KNOWN_GAPS[scope].filter(
        (name) => covered.has(name) || name in RETAINED,
      )
      expect(stale).toEqual([])
    }
  })

  it('covers the participant scope with the Staff rows and their logins', () => {
    expect([...declared('participant')].sort()).toEqual(
      expect.arrayContaining([
        'staff_participants',
        'staff_user_links',
        'user',
        'session',
      ]),
    )
  })
})
