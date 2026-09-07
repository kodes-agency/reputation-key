// BQC-2.7 — policy administration least-privilege proof.
//
// The policy.admin permission is owner-only by default: AccountAdmin passes
// the gate; PropertyManager and Staff deny with permission_denied. PMs hold
// organization.update (which is why policy.admin exists as a distinct
// permission — see src/shared/auth/permissions.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
