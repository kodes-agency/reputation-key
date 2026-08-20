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
  parseOperatorIdentities,
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
const CONSENT_FENCE = {
  authorizationLineageId: 'a4000000-0000-4000-8000-000000000001',
  capabilityEpoch: 7,
  authorizedSourceEpoch: 3,
  stateVersion: 5,
  noticeDigest: 'a'.repeat(64),
  runtimeProfileVersion: 'review-analysis-runtime-v1',
} as const

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
      request({
        action: 'system:gbp.reply.auto_publish',
        capability: 'gbp.reply.auto_publish',
      }),
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

  it('explicit consent selector: active → allow; missing → consent_required', async () => {
    const consent = {
      subjectType: 'property' as const,
      subjectId: PROP,
      purpose: 'ai.analyze',
      expectedFence: CONSENT_FENCE,
    }
    const hasActiveConsent = vi.fn(async () => true)
    const withConsent = createExecutionPolicy(deps({ hasActiveConsent }))
    const allow = await withConsent.decide(request({ propertyId: PROP, consent }))
    expect(allow.allowed).toBe(true)
    expect(hasActiveConsent).toHaveBeenCalledWith({
      organizationId: ORG,
      ...consent,
      at: new Date('2026-07-17T12:00:00Z'),
    })

    const withoutConsent = createExecutionPolicy(
      deps({ hasActiveConsent: async () => false }),
    )
    const deny = await withoutConsent.decide(request({ consent }))
    expect(deny.allowed).toBe(false)
    expect(deny.reason).toBe('consent_required')

    const malformedReader = vi.fn(async () => true)
    const malformed = await createExecutionPolicy(
      deps({ hasActiveConsent: malformedReader }),
    ).decide(
      request({
        propertyId: PROP,
        consent: { ...consent, subjectType: 'organization', subjectId: ORG },
      }),
    )
    expect(malformed.allowed).toBe(false)
    expect(malformed.reason).toBe('consent_required')
    expect(malformedReader).not.toHaveBeenCalled()
  })

  it('accepts a consent fence at the domain default source epoch of 0', async () => {
    // A property that has never been edited sits at source epoch 0, so its
    // consent fence carries 0. Requiring >= 1 here made every AI operation on a
    // freshly imported property deny `consent_required` (see drizzle/0060).
    const hasActiveConsent = vi.fn(async () => true)
    const policy = createExecutionPolicy(deps({ hasActiveConsent }))
    const decision = await policy.decide(
      request({
        propertyId: PROP,
        consent: {
          subjectType: 'property' as const,
          subjectId: PROP,
          purpose: 'ai.analyze',
          expectedFence: { ...CONSENT_FENCE, authorizedSourceEpoch: 0 },
        },
      }),
    )

    expect(decision.allowed).toBe(true)
    expect(hasActiveConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFence: expect.objectContaining({ authorizedSourceEpoch: 0 }),
      }),
    )
  })

  it('public principal: global capability on → allow, off → deny', async () => {
    const policy = createExecutionPolicy(deps())
    const allow = await policy.decide(
      request({
        principal: { kind: 'public' },
        action: 'system:identity.register',
        capability: 'identity.register',
        organizationId: undefined,
        executionKind: 'public',
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
        executionKind: 'public',
      }),
    )
    expect(allowCore.allowed).toBe(true)
  })
  it('public Portal decisions use resolved property scope and explicit consent assertions', async () => {
    initCapabilityPolicyStore({
      isCapabilityGloballyEnabled: () => false,
      isOrgAllowlisted: (organizationId, capability) =>
        organizationId === ORG && capability === 'portal.guest_media',
      isPropertyAllowlisted: (candidatePropertyId, capability) =>
        candidatePropertyId === PROP && capability === 'portal.guest_media',
      isOrgSuspended: () => false,
      isPropertySuspended: () => false,
    })
    const policy = createExecutionPolicy(deps())
    const consentAssertions = {
      analytics: false,
      response: true,
      freeText: false,
      contact: false,
      media: true,
    } as const
    const allowed = await policy.decide(
      request({
        principal: { kind: 'public', id: 'guest-session' },
        action: 'public:portal.media.issue',
        capability: 'portal.guest_media',
        organizationId: ORG,
        propertyId: PROP,
        executionKind: 'public',
        requiredPublicConsents: ['response', 'media'],
        consentAssertions,
      }),
    )
    expect(allowed.allowed).toBe(true)

    const wrongProperty = await policy.decide(
      request({
        principal: { kind: 'public' },
        action: 'public:portal.media.issue',
        capability: 'portal.guest_media',
        organizationId: ORG,
        propertyId: 'p2',
        executionKind: 'public',
        requiredPublicConsents: ['response', 'media'],
        consentAssertions,
      }),
    )
    expect(wrongProperty.reason).toBe('property_not_allowlisted')

    const declined = await policy.decide(
      request({
        principal: { kind: 'public' },
        action: 'public:portal.media.issue',
        capability: 'portal.guest_media',
        organizationId: ORG,
        propertyId: PROP,
        executionKind: 'public',
        requiredPublicConsents: ['response', 'media'],
        consentAssertions: { ...consentAssertions, media: false },
      }),
    )
    expect(declined.reason).toBe('consent_required')
  })

  it('system principal denies as unsupported (BQC-2.5 contract lives in the delayed policy)', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(
      request({ principal: { kind: 'system', id: 'worker' } }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unsupported_principal')
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

describe('operator principal (BQC-7.5)', () => {
  const OPERATOR = 'op-1@example.com'

  function operatorRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
    return request({
      principal: { kind: 'operator', id: OPERATOR },
      action: 'system:ops',
      capability: undefined,
      executionKind: 'operator',
      ...overrides,
    })
  }

  it('allows a registered operator and audits the allow with the operator reason', async () => {
    const writeDecisionAudit = vi.fn(async (_entry: DecisionAuditEntry) => {})
    const policy = createExecutionPolicy(
      deps({ isRegisteredOperator: () => true, writeDecisionAudit }),
    )
    const decision = await policy.decide(operatorRequest({ reason: 'read' }))
    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('allowed')
    await vi.waitFor(() => expect(writeDecisionAudit).toHaveBeenCalledTimes(1))
    expect(writeDecisionAudit.mock.calls[0][0]).toMatchObject({
      actorType: 'operator',
      actorId: OPERATOR,
      organizationId: ORG,
      action: 'system:ops',
      executionKind: 'operator',
      decision: 'allow',
      reason: 'read',
      policyVersion: EXECUTION_POLICY_VERSION,
      correlationId: 'corr-test',
    })
  })

  it('denies an unregistered operator BEFORE any capability evaluation', async () => {
    const writeDecisionAudit = vi.fn(async (_entry: DecisionAuditEntry) => {})
    const policy = createExecutionPolicy(
      deps({
        isRegisteredOperator: (id) => id === 'someone-else',
        writeDecisionAudit,
      }),
    )
    // The capability would deny too (blocked) — the identity deny comes first.
    const decision = await policy.decide(operatorRequest({ capability: 'portal.write' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('operator_not_registered')
    await vi.waitFor(() => expect(writeDecisionAudit).toHaveBeenCalledTimes(1))
    expect(writeDecisionAudit.mock.calls[0][0]).toMatchObject({
      actorType: 'operator',
      actorId: OPERATOR,
      decision: 'deny',
      reason: 'operator_not_registered',
    })
  })

  it('fails closed when no operator allowlist dep is bound', async () => {
    const policy = createExecutionPolicy(deps())
    const decision = await policy.decide(operatorRequest())
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('operator_not_registered')
  })

  it('denies an operator principal executing as a non-operator kind', async () => {
    const policy = createExecutionPolicy(deps({ isRegisteredOperator: () => true }))
    const decision = await policy.decide(operatorRequest({ executionKind: 'worker' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unsupported_principal')
  })

  it('denies when the declared capability is blocked (org-scoped)', async () => {
    const policy = createExecutionPolicy(deps({ isRegisteredOperator: () => true }))
    const decision = await policy.decide(
      operatorRequest({ capability: 'gbp.reply.auto_publish' }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('capability_blocked')
  })

  it('denies when the org is suspended (org-scoped capability check)', async () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_SUSPENDED_ORGS: ORG }),
    )
    const policy = createExecutionPolicy(deps({ isRegisteredOperator: () => true }))
    const decision = await policy.decide(operatorRequest({ capability: 'review.use' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('org_suspended')
  })

  it('global scope (no org) evaluates the global capability gate only', async () => {
    const policy = createExecutionPolicy(deps({ isRegisteredOperator: () => true }))
    const deny = await policy.decide(
      operatorRequest({ organizationId: undefined, capability: 'team.use' }),
    )
    expect(deny.allowed).toBe(false)
    // team.use is non-core → globally off without an e2e override.
    expect(deny.reason).toBe('capability_disabled')

    const allow = await policy.decide(
      operatorRequest({ organizationId: undefined, capability: 'review.use' }),
    )
    expect(allow.allowed).toBe(true)
  })

  it('deny rows keep the typed deny reason even when the operator supplied one', async () => {
    const writeDecisionAudit = vi.fn(async (_entry: DecisionAuditEntry) => {})
    const policy = createExecutionPolicy(deps({ writeDecisionAudit }))
    const decision = await policy.decide(operatorRequest({ reason: 'cleanup run' }))
    expect(decision.reason).toBe('operator_not_registered')
    await vi.waitFor(() => expect(writeDecisionAudit).toHaveBeenCalledTimes(1))
    expect(writeDecisionAudit.mock.calls[0][0].reason).toBe('operator_not_registered')
  })

  it('explicit consent declared: active → allow; no reader → consent_required', async () => {
    const consent = {
      subjectType: 'property' as const,
      subjectId: PROP,
      purpose: 'ai.analyze',
      expectedFence: CONSENT_FENCE,
    }
    const withConsent = createExecutionPolicy(
      deps({ isRegisteredOperator: () => true, hasActiveConsent: async () => true }),
    )
    const allow = await withConsent.decide(operatorRequest({ propertyId: PROP, consent }))
    expect(allow.allowed).toBe(true)

    const without = createExecutionPolicy(deps({ isRegisteredOperator: () => true }))
    const deny = await without.decide(operatorRequest({ propertyId: PROP, consent }))
    expect(deny.allowed).toBe(false)
    expect(deny.reason).toBe('consent_required')
  })

  it('flushAudits awaits pending audit writes (CLI durability, BQC-7.5)', async () => {
    let resolveSink: () => void = () => {}
    const writeDecisionAudit = vi.fn(
      (_entry: DecisionAuditEntry) =>
        new Promise<void>((resolve) => {
          resolveSink = resolve
        }),
    )
    const policy = createExecutionPolicy(deps({ writeDecisionAudit }))
    await policy.decide(operatorRequest({ reason: 'read' }))

    let flushed = false
    const flush = policy.flushAudits().then(() => {
      flushed = true
    })
    // The sink has not resolved — the flush must still be waiting.
    await Promise.resolve()
    expect(flushed).toBe(false)

    resolveSink()
    await flush
    expect(flushed).toBe(true)
    expect(writeDecisionAudit).toHaveBeenCalledTimes(1)
  })

  it('parseOperatorIdentities parses the comma-separated allowlist', () => {
    expect(
      parseOperatorIdentities({ OPS_OPERATOR_IDENTITIES: ' a@x.io , b@x.io ,, ' }),
    ).toEqual(new Set(['a@x.io', 'b@x.io']))
    expect(parseOperatorIdentities({})).toEqual(new Set())
    expect(parseOperatorIdentities({ OPS_OPERATOR_IDENTITIES: '' })).toEqual(new Set())
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
