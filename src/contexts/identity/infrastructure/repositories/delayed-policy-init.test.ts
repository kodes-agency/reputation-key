// BQC-2.5 — delayed/system policy contract wiring proof (real PostgreSQL).
//
// The contract's money rule: an external-effect action performs a strong
// policy read immediately before deciding, so a suspension written NOW
// denies NOW — not after the 5s polling bound. Proves the composition seam
// through initPersistedCapabilityPolicyStore.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  getDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import { setOrganizationPolicy } from './policy-state.repository'

const db = getDb()
const ORG = 'org-delayed-init'
const POLICY_ENV = {
  NODE_ENV: 'test',
  BETA_E2E_GLOBAL_CAPABILITIES: 'notification.send_email',
} satisfies CapabilityPolicyEnv

beforeAll(async () => {
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Delayed Org', ${ORG}, now())`,
  )
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  // ARC-03-T8: the handle no longer installs itself — the process
  // installation is the explicit bind.
  bindProcessPolicies(
    initPersistedCapabilityPolicyStore({
      db,
      env: POLICY_ENV,
      clock: () => new Date(),
      logger: { warn: () => {} },
    }),
  )
})

afterAll(async () => {
  releaseProcessPolicies()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
})

describe('delayed policy contract wiring (BQC-2.5)', () => {
  it('suspension denies immediately via the strong read', async () => {
    const policy = getDelayedExecutionPolicy()
    const base = {
      principal: { kind: 'system', id: 'worker:default' } as const,
      // This test proves the generic external-effect strong-read contract.
      // Google provider actions are separately default-denied until their
      // exact approval/connection vectors are present, so use the locally
      // enabled notification effect instead of weakening that provider fence.
      action: 'system:notification.email_digest',
      organizationId: ORG,
      capabilityAtEnqueue: 'notification.send_email' as const,
      executionKind: 'worker' as const,
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    }

    // Current policy allows (capability core, no suspension).
    const before = await policy.decide({ ...base, now: new Date() })
    expect(before.outcome).toBe('allow')
    expect(before.freshRead).toBe(true)

    // Suspend the org — the very next decision denies NOW (strong read),
    // without waiting for the 5s polling bound.
    await setOrganizationPolicy(db, { organizationId: ORG, suspendedAt: new Date() })
    const after = await policy.decide({ ...base, now: new Date() })
    expect(after.outcome).toBe('deny')
    expect(after.reason).toBe('org_suspended')
    expect(after.allowed).toBe(false)

  })
})
