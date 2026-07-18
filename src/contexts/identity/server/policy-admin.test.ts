// BQC-2.7 — policy administration least-privilege proof.
//
// The policy.admin permission is owner-only by default: AccountAdmin passes
// the gate; PropertyManager and Staff deny with permission_denied. PMs hold
// organization.update (which is why policy.admin exists as a distinct
// permission — see src/shared/auth/permissions.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  requireExecutionAllowed,
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

const ORG = 'org-padmin-gate'

function ctx(role: AuthContext['role']): AuthContext {
  return {
    userId: userId('user-padmin-gate'),
    organizationId: organizationId(ORG),
    role,
  }
}

beforeEach(() => {
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  initExecutionPolicy(
    createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
  )
})

afterEach(() => {
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
})

describe('policy.admin least privilege (BQC-2.7)', () => {
  it('AccountAdmin passes the policy.admin gate', async () => {
    await expect(
      requireExecutionAllowed({ actor: ctx('AccountAdmin'), action: 'policy.admin' }),
    ).resolves.toBeUndefined()
  })

  it('PropertyManager denies (despite holding organization.update)', async () => {
    await expect(
      requireExecutionAllowed({ actor: ctx('PropertyManager'), action: 'policy.admin' }),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'permission_denied', status: 403 })
  })

  it('Staff denies', async () => {
    await expect(
      requireExecutionAllowed({ actor: ctx('Staff'), action: 'policy.admin' }),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'permission_denied', status: 403 })
  })
})

describe('getRegionDiagnosticFn gate (BQC-4.4)', () => {
  // The catalogue guard (entry-point-catalogue.test.ts) mechanically verifies
  // the row ↔ code match; this pins the gate explicitly on the fn slice.
  it('is gated by requireExecutionAllowed policy.admin with the target property', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/contexts/identity/server/policy-admin.ts'),
      'utf-8',
    )
    const start = source.indexOf('export const getRegionDiagnosticFn')
    expect(start, 'getRegionDiagnosticFn must exist').toBeGreaterThanOrEqual(0)
    const slice = source.slice(start)
    expect(slice).toMatch(/requireExecutionAllowed\(\{[\s\S]*?action: 'policy\.admin'/)
    expect(slice).toMatch(
      /requireExecutionAllowed\(\{[\s\S]*?propertyId: data\.propertyId/,
    )
  })
})
