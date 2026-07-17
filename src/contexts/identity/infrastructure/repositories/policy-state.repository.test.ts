// BQC-2.2 — organization/property policy state integration test (real PostgreSQL).
//
// Proves persisted cohort, non-core capability allowlists, and suspension:
//   - upsert/read semantics for organization_policy and property_policy;
//   - allowlist add/remove with (org, capability) / (property, capability)
//     uniqueness enforced by primary key;
//   - snapshot loading for the persisted policy store;
//   - every mutation bumps the global policy_version in the same transaction.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  setOrganizationPolicy,
  setPropertyPolicy,
  addOrganizationCapability,
  removeOrganizationCapability,
  addPropertyCapability,
  removePropertyCapability,
  loadPolicySnapshot,
  getPolicyVersion,
} from './policy-state.repository'

const db = getDb()
const ORG = 'org-policy-state'
let prop: string

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Policy Org', ${ORG}, now())`,
  )
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${ORG}, 'policy-prop', 'policy-prop', 'UTC')
    RETURNING id
  `)
  prop = (rows.rows[0] as { id: string }).id
})

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('policy state persistence (BQC-2.2)', () => {
  it('upserts organization policy (cohort + suspension)', async () => {
    await setOrganizationPolicy(db, { organizationId: ORG, cohort: 'beta' })
    let snapshot = await loadPolicySnapshot(db)
    let record = snapshot.orgPolicies.find((p) => p.organizationId === ORG)
    expect(record?.cohort).toBe('beta')
    expect(record?.suspendedAt).toBeNull()

    const suspendedAt = new Date('2026-07-17T12:00:00Z')
    await setOrganizationPolicy(db, {
      organizationId: ORG,
      suspendedAt,
      suspendedReason: 'ticket-123',
    })
    snapshot = await loadPolicySnapshot(db)
    record = snapshot.orgPolicies.find((p) => p.organizationId === ORG)
    expect(record?.suspendedAt?.toISOString()).toBe(suspendedAt.toISOString())
    expect(record?.suspendedReason).toBe('ticket-123')
  })

  it('adds and removes organization capabilities with PK uniqueness', async () => {
    await addOrganizationCapability(db, ORG, 'team.use', 'op-test')
    await expect(
      addOrganizationCapability(db, ORG, 'team.use', 'op-test'),
    ).rejects.toThrow()

    let snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'team.use',
      ),
    ).toBe(true)

    await removeOrganizationCapability(db, ORG, 'team.use')
    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'team.use',
      ),
    ).toBe(false)
  })

  it('upserts property policy and manages property capabilities', async () => {
    await setPropertyPolicy(db, { propertyId: prop, suspendedAt: new Date() })
    await addPropertyCapability(db, prop, 'portal.read', 'op-test')

    const snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.propertyPolicies.find((p) => p.propertyId === prop)?.suspendedAt,
    ).not.toBeNull()
    expect(
      snapshot.propertyCapabilities.some(
        (c) => c.propertyId === prop && c.capability === 'portal.read',
      ),
    ).toBe(true)

    await removePropertyCapability(db, prop, 'portal.read')
    const after = await loadPolicySnapshot(db)
    expect(
      after.propertyCapabilities.some(
        (c) => c.propertyId === prop && c.capability === 'portal.read',
      ),
    ).toBe(false)
  })

  it('bumps the global policy_version on every mutation', async () => {
    const before = await getPolicyVersion(db)
    await setOrganizationPolicy(db, { organizationId: ORG, cohort: 'beta' })
    const v1 = await getPolicyVersion(db)
    await addOrganizationCapability(db, ORG, 'goal.use')
    const v2 = await getPolicyVersion(db)
    await setPropertyPolicy(db, { propertyId: prop, suspendedAt: null })
    const v3 = await getPolicyVersion(db)
    expect(v1).toBeGreaterThan(before)
    expect(v2).toBeGreaterThan(v1)
    expect(v3).toBeGreaterThan(v2)

    const snapshot = await loadPolicySnapshot(db)
    expect(snapshot.version).toBe(v3)
  })
})
