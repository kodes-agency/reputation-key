// The policy diagnostic explains the decision the live policy would make. The
// member's role is stored as a Better Auth token (`owner`, `admin`, `member`);
// the permission table is keyed by domain role, so the diagnostic maps the
// token the way tenant resolution does before it asks.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from './beta-capabilities'
import { createPolicyDiagnostic } from './policy-diagnostic'

const ORG = 'org-policy-diagnostic'
const PROPERTY_ID = 'd4000000-0000-4000-8000-000000000101'
const NOW = new Date('2026-07-17T12:00:00Z')

function diagnostic(input: Readonly<{ roleToken: string | null; hasGrant?: boolean }>) {
  return createPolicyDiagnostic({
    getMemberRole: async () => input.roleToken,
    hasActiveGrant: async () => input.hasGrant ?? false,
  })
}

const ask = (
  input: Parameters<typeof diagnostic>[0],
  action: Parameters<ReturnType<typeof createPolicyDiagnostic>>[0]['action'],
) =>
  diagnostic(input)({
    organizationId: ORG,
    action,
    propertyId: PROPERTY_ID,
    userId: 'user-under-diagnosis',
    now: NOW,
  })

beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
})

afterEach(resetCapabilityPolicyStore)

describe('policy diagnostic', () => {
  it('allows an AccountAdmin (stored as `owner`) what the role holds, Organization-wide', async () => {
    await expect(ask({ roleToken: 'owner' }, 'property.read')).resolves.toMatchObject({
      allowed: true,
      reason: 'allowed',
      checks: {
        capability: { allowed: true },
        permission: { allowed: true },
        scope: { outcome: 'organization' },
      },
    })
    await expect(ask({ roleToken: 'owner' }, 'policy.admin')).resolves.toMatchObject({
      allowed: true,
      checks: { permission: { allowed: true } },
    })
  })

  it('allows a PropertyManager (stored as `admin`) on a Property it holds a grant for', async () => {
    await expect(
      ask({ roleToken: 'admin', hasGrant: true }, 'property.read'),
    ).resolves.toMatchObject({
      allowed: true,
      reason: 'allowed',
      checks: { permission: { allowed: true }, scope: { outcome: 'granted' } },
    })
  })

  it('denies a PropertyManager by scope, not by permission, without a grant', async () => {
    await expect(
      ask({ roleToken: 'admin', hasGrant: false }, 'property.read'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'scope_denied',
      checks: { permission: { allowed: true }, scope: { outcome: 'missing_grant' } },
    })
  })

  it('denies a PropertyManager a permission the role does not hold', async () => {
    await expect(
      ask({ roleToken: 'admin', hasGrant: true }, 'policy.admin'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'permission_denied',
      checks: { permission: { allowed: false } },
    })
  })

  it.each([
    ['the retained `member` role', 'member'],
    ['a role that is not built in', 'editor'],
    ['a multi-role token', 'owner,editor'],
  ])(
    'denies %s as tenant resolution does: no active beta role',
    async (_label, token) => {
      // `property.read` is in the Member table; the live policy never reaches
      // it, because a login without an active manager role resolves no tenant.
      await expect(
        ask({ roleToken: token, hasGrant: true }, 'property.read'),
      ).resolves.toMatchObject({
        allowed: false,
        reason: 'beta_role_inactive',
        checks: { permission: { allowed: false }, scope: { outcome: 'not_applicable' } },
      })
    },
  )

  it('says a user with no membership is not a member', async () => {
    await expect(ask({ roleToken: null }, 'property.read')).resolves.toMatchObject({
      allowed: false,
      reason: 'not_a_member',
    })
  })
})
