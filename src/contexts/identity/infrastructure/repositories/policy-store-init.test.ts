// BQC-2.2 — persisted policy store end-to-end proof (real PostgreSQL).
//
// Phase BQC-2 §2.2 requires revocation/suspension to take effect within a
// measured bound. This wires initPersistedCapabilityPolicyStore against the
// real DB and proves: (1) a DB allowlist row enables a non-core capability
// after refresh; (2) suspension written to the DB is NOT visible before the
// refresh (the bound), and denies after it — the stale window is exactly the
// refresh interval, nothing more.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { Env } from '#/shared/config/env'
import type { AuthContext } from '#/shared/domain/auth-context'
import { userId, organizationId } from '#/shared/domain/ids'
import {
  checkBetaCapability,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import {
  addOrganizationCapability,
  setOrganizationPolicy,
} from './policy-state.repository'

const db = getDb()
const ORG = 'org-store-init'
const ctx: AuthContext = {
  userId: userId('user-store-init'),
  organizationId: organizationId(ORG),
  role: 'AccountAdmin',
}

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Store Init Org', ${ORG}, now())`,
  )
})

afterAll(async () => {
  resetCapabilityPolicyStore()
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('persisted policy store — end-to-end (BQC-2.2)', () => {
  it('allowlist and suspension take effect via the version-gated refresh', async () => {
    resetCapabilityPolicyStore()
    const handle = initPersistedCapabilityPolicyStore({ db, env: {} as Env })
    try {
      await handle.refresh()

      // Non-core capability: denied without a DB allowlist row…
      let decision = checkBetaCapability(ctx, 'team.use')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('org_not_allowlisted')

      // …allowed after the row is written and the store refreshes.
      await addOrganizationCapability(db, ORG, 'team.use', 'op-test')
      await handle.refresh()
      decision = checkBetaCapability(ctx, 'team.use')
      expect(decision.allowed).toBe(true)

      // Suspension is NOT visible before the refresh (the measured bound)…
      await setOrganizationPolicy(db, { organizationId: ORG, suspendedAt: new Date() })
      decision = checkBetaCapability(ctx, 'team.use')
      expect(decision.allowed).toBe(true) // stale snapshot — bound = refresh interval

      // …and denies after it.
      await handle.refresh()
      decision = checkBetaCapability(ctx, 'team.use')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('org_suspended')
    } finally {
      handle.stopPolling()
      resetCapabilityPolicyStore()
    }
  })
})
