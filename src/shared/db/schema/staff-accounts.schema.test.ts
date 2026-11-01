import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { staffOnboardings, staffPropertySettings } from './staff-accounts.schema'
import { staffParticipations, staffUserLinks } from './people-access.schema'
import { portals } from './portal.schema'
import { invitation } from './auth'

const migration = readFileSync('drizzle/0093_staff_accounts.sql', 'utf8')
const dialect = new PgDialect()

describe('staff account schema and migration contract', () => {
  it('leaves the invitation extension to the earlier Better Auth migration track', () => {
    expect(invitation.staffParticipationId.name).toBe('staffParticipationId')
    expect(migration).not.toContain(
      'ALTER TABLE invitation ADD COLUMN "staffParticipationId"',
    )
  })
  it('keeps personal ownership in the same Organization and Property and restricts deletion', () => {
    const config = getTableConfig(staffParticipations)
    const fk = config.foreignKeys.find(
      (key) => key.getName() === 'sp_personal_portal_tenant_fk',
    )!
    expect(fk.reference().columns.map((column) => column.name)).toEqual([
      'organization_id',
      'property_id',
      'personal_portal_id',
    ])
    expect(fk.reference().foreignColumns.map((column) => column.name)).toEqual([
      'organization_id',
      'property_id',
      'id',
    ])
    expect(fk.onDelete).toBe('restrict')
    const unique = config.indexes.find(
      (index) => index.config.name === 'sp_unique_active_personal_portal',
    )!
    expect(unique.config.unique).toBe(true)
    expect(dialect.sqlToQuery(unique.config.where!).sql).toContain("status = 'active'")
    expect(migration).toContain(
      'REFERENCES portals (organization_id, property_id, id) ON DELETE RESTRICT',
    )
  })
  it('requires finished operations to scrub names and email, and reserves unfinished addresses only', () => {
    const config = getTableConfig(staffOnboardings)
    const checks = config.checks.map((check) => check.name)
    expect(checks).toEqual([
      'staff_onboardings_status_valid',
      'staff_onboardings_email_lowercase',
      'staff_onboardings_finished_identifiers_only',
    ])
    const index = config.indexes.find(
      (index) => index.config.name === 'staff_onboardings_unfinished_address',
    )!
    expect(index.config.unique).toBe(true)
    expect(dialect.sqlToQuery(index.config.where!).sql).toContain(
      "status IN ('running', 'failed')",
    )
    expect(migration).toContain(
      "status NOT IN ('done', 'cancelled') OR (email IS NULL AND display_name IS NULL)",
    )
  })
  it('defaults to place and a disabled colleague list, and keeps acceptance and notice columns nullable', () => {
    expect(portals.kind.default).toBe('place')
    expect(portals.kind.notNull).toBe(true)
    expect(portals.publicName.notNull).toBe(false)
    expect(getTableConfig(portals).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'portals_kind_valid',
        'portals_personal_public_name_required',
      ]),
    )
    expect(staffPropertySettings.colleagueListEnabled.default).toBe(false)
    expect(
      getTableConfig(staffPropertySettings).primaryKeys[0]?.columns.map(
        (column) => column.name,
      ),
    ).toEqual(['organization_id', 'property_id'])
    expect(invitation.staffParticipationId.notNull).toBe(false)
    expect(staffUserLinks.noticeVersion.notNull).toBe(false)
    expect(staffUserLinks.noticeAcknowledgedAt.notNull).toBe(false)
  })
})
