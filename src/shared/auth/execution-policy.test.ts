// BQC-2.4 — ExecutionPolicy decision matrix (unit).
//
// The one fail-closed decision point (phase BQC-2 §3): principal + action +
// org/property + execution kind + purpose + time + correlation → allow or
// typed deny with stable reason and policy version. Role permissions,
// PropertyAccessGrant, allowlist, suspension, capability state, consent,
// caches, and decision audit are hidden inside.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  requireExecutionAllowed,
  registerExecutionPolicyInit,
  resetExecutionPolicy,
  EXECUTION_POLICY_VERSION,
  type DecisionAuditEntry,
  type DecisionRequest,
  type ExecutionPolicyDeps,
} from './execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from './beta-capabilities'
import { organizationId, userId, propertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

const ORG = 'org-policy'
const USER = 'user-policy'
const PROP = 'd4000000-0000-4000-8000-000000000001'

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: userId(USER),
    organizationId: organizationId(ORG),
    role: 'AccountAdmin',
    ...overrides,
  }
}

/** Assigned-scope principal (PropertyManager-like) without touching the permission table. */
function assignedCtx(perms: ReadonlyArray<Permission>): AuthContext {
  return ctx({
    role: 'PropertyManager',
    effectivePermissions: new Set(perms),
    scopeByPermission: new Map(perms.map((p) => [p, 'assigned-properties' as const])),
  })
}

function orgWideCtx(perms: ReadonlyArray<Permission>): AuthContext {
  return ctx({
    role: 'AccountAdmin',
    effectivePermissions: new Set(perms),
    scopeByPermission: new Map(perms.map((p) => [p, 'organization' as const])),
  })
}

function deps(overrides: Partial<ExecutionPolicyDeps> = {}): ExecutionPolicyDeps {
  return {
    listAccessiblePropertyIds: async () => [],
    ...overrides,
  }
}

function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    principal: { kind: 'user', ctx: orgWideCtx(['property.read']) },
    action: 'property.read',
    organizationId: ORG,
    executionKind: 'interactive',
    now: new Date('2026-07-17T12:00:00Z'),
    correlationId: 'corr-test',
    ...overrides,
  }
}

beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
})

afterEach(() => {
  resetCapabilityPolicyStore()
})

describe('ExecutionPolicy decision matrix (BQC-2.4)', () => {
  it('allows a permitted user action and stamps the policy version', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(request())
    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('allowed')
    expect(decision.policyVersion).toBe(EXECUTION_POLICY_VERSION)
  })

  it('denies a blocked capability before any permission check', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(
      request({ action: 'portal.create', capability: 'portal.write' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('capability_blocked')
  })

  it('denies a non-core capability without an org allowlist row', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(
      request({ action: 'team.read', capability: 'team.use' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('org_not_allowlisted')
  })

  it('denies when the permission is missing', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(
      request({
        principal: { kind: 'user', ctx: orgWideCtx([]) },
        action: 'property.read',
      }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('permission_denied')
  })

  it('org-scope roles pass property scope without a grant lookup', async () => {
    const listAccessiblePropertyIds = vi.fn(async () => [])
    const policy = createExecutionPolicy(deps({ listAccessiblePropertyIds }))
    const decision = await policy.decide(request({ propertyId: PROP }))
    expect(decision.allowed).toBe(true)
    expect(listAccessiblePropertyIds).not.toHaveBeenCalled()
  })

  it('assigned-scope role + grant present → allow', async () => {
    const policy = createExecutionPolicy(
      deps({ listAccessiblePropertyIds: async () => [PROP] }),
    )
    const decision = await policy.decide(
      request({
        principal: { kind: 'user', ctx: assignedCtx(['property.read']) },
        propertyId: PROP,
      }),
    )
    expect(decision.allowed).toBe(true)
  })

  it('assigned-scope role + NO grant → scope_denied (missing scope = deny)', async () => {
    const policy = createExecutionPolicy(
      deps({ listAccessiblePropertyIds: async () => [] }),
    )
    const decision = await policy.decide(
      request({
        principal: { kind: 'user', ctx: assignedCtx(['property.read']) },
        propertyId: PROP,
      }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('scope_denied')
  })

  it("assigned-scope role + action with scope 'none' → scope_denied", async () => {
    const actor = ctx({
      role: 'PropertyManager',
      effectivePermissions: new Set<Permission>(['property.read']),
      scopeByPermission: new Map([['property.read', 'none' as const]]),
    })
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(
      request({ principal: { kind: 'user', ctx: actor }, propertyId: PROP }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('scope_denied')
  })

  it('grant lookup failure denies — never fail-open', async () => {
    const policy = createExecutionPolicy(
      deps({
        listAccessiblePropertyIds: async () => {
          throw new Error('grant store down')
        },
      }),
    )
    const decision = await policy.decide(
      request({
        principal: { kind: 'user', ctx: assignedCtx(['property.read']) },
        propertyId: PROP,
      }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('policy_unavailable')
  })

  it('purpose required: consent active → allow; missing → consent_required', async () => {
    const withConsent = createExecutionPolicy(
      deps({ hasActiveConsent: async () => true }),
    )
    const allow = await withConsent.decide(request({ purpose: 'ai.analyze' }))
    expect(allow.allowed).toBe(true)

    const withoutConsent = createExecutionPolicy(
      deps({ hasActiveConsent: async () => false }),
    )
    const deny = await withoutConsent.decide(request({ purpose: 'ai.analyze' }))
    expect(deny.allowed).toBe(false)
    expect(deny.reason).toBe('consent_required')
  })

  it('public principal: global capability on → allow, off → deny', async () => {
    const policy = createExecutionPolicy(deps())
    const allow = await policy.decide(
      request({
        principal: { kind: 'public' },
        action: 'system:identity.register',
        capability: 'identity.register',
        organizationId: undefined,
      }),
    )
    // identity.register is non-core → globally off without e2e override
    expect(allow.allowed).toBe(false)

    const allowCore = await policy.decide(
      request({
        principal: { kind: 'public' },
        action: 'system:identity.sign_in',
        capability: undefined,
        organizationId: undefined,
      }),
    )
    expect(allowCore.allowed).toBe(true)
  })

  it('system/operator principals deny as unsupported until the BQC-2.5 contract', async () => {
    const policy = createExecutionPolicy(deps())
    for (const principal of [
      { kind: 'system', id: 'worker' } as const,
      { kind: 'operator', id: 'op-1' } as const,
    ]) {
      const decision = await policy.decide(request({ principal }))
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('unsupported_principal')
    }
  })

  it('denies when request organization differs from the principal org', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(request({ organizationId: 'org-other' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('principal_org_mismatch')
  })

  it('writes a content-free decision audit; audit failure never changes the decision', async () => {
    const writeDecisionAudit = vi.fn(async (_entry: DecisionAuditEntry) => {
      throw new Error('audit sink down')
    })
    const onAuditError = vi.fn()
    const policy = createExecutionPolicy(deps({ writeDecisionAudit, onAuditError }))
    const decision = await policy.decide(request({ propertyId: PROP }))
    expect(decision.allowed).toBe(true)
    await vi.waitFor(() => expect(writeDecisionAudit).toHaveBeenCalledTimes(1))
    const entry = writeDecisionAudit.mock.calls[0][0]
    expect(entry).toMatchObject({
      actorType: 'user',
      actorId: USER,
      organizationId: ORG,
      propertyId: PROP,
      action: 'property.read',
      executionKind: 'interactive',
      decision: 'allow',
      reason: 'allowed',
      policyVersion: EXECUTION_POLICY_VERSION,
      correlationId: 'corr-test',
    })
    await vi.waitFor(() => expect(onAuditError).toHaveBeenCalledTimes(1))
  })
})

describe('requireExecutionAllowed (BQC-2.4 migration helper)', () => {
  it('throws a serializable AuthError with the stable reason on deny', async () => {
    initExecutionPolicy(createExecutionPolicy(deps()))
    await expect(
      requireExecutionAllowed({
        actor: assignedCtx(['property.read']),
        action: 'property.read',
        propertyId: propertyId(PROP),
      }),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      code: 'scope_denied',
      status: 403,
    })
  })

  it('passes on allow', async () => {
    initExecutionPolicy(createExecutionPolicy(deps()))
    await expect(
      requireExecutionAllowed({
        actor: orgWideCtx(['property.read']),
        action: 'property.read',
        propertyId: propertyId(PROP),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('registerExecutionPolicyInit (cold-boot lazy init)', () => {
  it('still throws when uninitialized and no initializer is registered', async () => {
    resetExecutionPolicy()
    await expect(
      requireExecutionAllowed({
        actor: orgWideCtx(['property.read']),
        action: 'property.read',
      }),
    ).rejects.toThrow(/not initialized/)
  })

  it('fires the registered initializer on first read (the cold-boot race fix)', async () => {
    resetExecutionPolicy()
    const install = vi.fn(() => initExecutionPolicy(createExecutionPolicy(deps())))
    registerExecutionPolicyInit(install)

    await expect(
      requireExecutionAllowed({
        actor: orgWideCtx(['property.read']),
        action: 'property.read',
      }),
    ).resolves.toBeUndefined()
    expect(install).toHaveBeenCalledTimes(1)

    // Second read uses the installed policy — the initializer does not re-fire.
    await expect(
      requireExecutionAllowed({
        actor: orgWideCtx(['property.read']),
        action: 'property.read',
      }),
    ).resolves.toBeUndefined()
    expect(install).toHaveBeenCalledTimes(1)
  })
})
