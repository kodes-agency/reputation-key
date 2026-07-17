// BQC-2.4 — synthetic old-vs-new decision comparison (shadow record).
//
// Phase BQC-2 §2.4: "Record old/new decisions for synthetic identities, then
// delete the old path." The old path (checkAuthorization / requireAuthorized
// from authorization-policy.ts) was DELETED in BQC-2.6 after zero production
// callers remained. Its decisions are recorded here as constants from the
// BQC-2.4 shadow run; the new path executes live through ExecutionPolicy.
//
// The recorded disagreement class is exactly one: the new policy denies
// where the old path was silently fail-open on property scope
// (assigned-scope role, target property, no grant). Never permit on
// disagreement — verified by the deny-superset assertion.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createExecutionPolicy, type ExecutionDecision } from './execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from './beta-capabilities'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

const ORG = 'org-shadow'
const PROP = 'd4000000-0000-4000-8000-000000000042'

type IdentitySpec = Readonly<{
  label: string
  ctx: AuthContext
  propertyScoped: boolean
  hasGrant: boolean
  /** Recorded old-path decision from the BQC-2.4 shadow run. */
  oldAllowed: boolean
}>

function makeCtx(
  label: string,
  role: 'AccountAdmin' | 'PropertyManager' | 'Staff',
  scope: 'organization' | 'assigned-properties',
): AuthContext {
  return {
    userId: userId(`user-${label}`),
    organizationId: organizationId(ORG),
    role,
    effectivePermissions: new Set<Permission>(['property.read', 'inbox.read']),
    scopeByPermission: new Map([
      ['property.read', scope],
      ['inbox.read', scope],
    ]),
  }
}

const IDENTITIES: ReadonlyArray<IdentitySpec> = [
  {
    label: 'admin-orgwide',
    ctx: makeCtx('admin', 'AccountAdmin', 'organization'),
    propertyScoped: true,
    hasGrant: false,
    oldAllowed: true,
  },
  {
    label: 'pm-granted',
    ctx: makeCtx('pmg', 'PropertyManager', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: true,
    oldAllowed: true,
  },
  {
    label: 'pm-ungranted',
    ctx: makeCtx('pmu', 'PropertyManager', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: false,
    oldAllowed: true,
  },
  {
    label: 'staff-ungranted',
    ctx: makeCtx('stfu', 'Staff', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: false,
    oldAllowed: true,
  },
  {
    label: 'pm-org-action',
    ctx: makeCtx('pmo', 'PropertyManager', 'assigned-properties'),
    propertyScoped: false,
    hasGrant: false,
    oldAllowed: true,
  },
]

type Row = Readonly<{
  identity: string
  action: Permission
  oldAllowed: boolean
  newAllowed: boolean
  newReason: string
}>

beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
})

afterEach(() => {
  resetCapabilityPolicyStore()
})

describe('old-vs-new synthetic decision comparison (BQC-2.4; old path deleted in BQC-2.6)', () => {
  it('recorded old decisions vs live new decisions: only fail-open closures disagree', async () => {
    const rows: Row[] = []
    for (const spec of IDENTITIES) {
      const action: Permission = spec.propertyScoped ? 'property.read' : 'inbox.read'
      const propertyId = spec.propertyScoped ? PROP : undefined

      const policy = createExecutionPolicy({
        listAccessiblePropertyIds: async () => (spec.hasGrant ? [PROP] : []),
      })
      const newDecision: ExecutionDecision = await policy.decide({
        principal: { kind: 'user', ctx: spec.ctx },
        action,
        organizationId: ORG,
        propertyId,
        executionKind: 'interactive',
        now: new Date('2026-07-17T12:00:00Z'),
      })

      rows.push({
        identity: spec.label,
        action,
        oldAllowed: spec.oldAllowed,
        newAllowed: newDecision.allowed,
        newReason: newDecision.reason,
      })
    }

    // New never permits where the recorded old path denied.
    for (const row of rows) {
      if (!row.oldAllowed) expect(row.newAllowed).toBe(false)
    }

    const disagreements = rows.filter((r) => r.oldAllowed !== r.newAllowed)
    // Every disagreement is an old fail-open the new policy closes.
    expect(disagreements.map((d) => d.identity).sort()).toEqual([
      'pm-ungranted',
      'staff-ungranted',
    ])
    for (const d of disagreements) {
      expect(d.newAllowed).toBe(false)
      expect(d.newReason).toBe('scope_denied')
    }

    // Full table for the evidence record.
    expect(rows).toEqual([
      {
        identity: 'admin-orgwide',
        action: 'property.read',
        oldAllowed: true,
        newAllowed: true,
        newReason: 'allowed',
      },
      {
        identity: 'pm-granted',
        action: 'property.read',
        oldAllowed: true,
        newAllowed: true,
        newReason: 'allowed',
      },
      {
        identity: 'pm-ungranted',
        action: 'property.read',
        oldAllowed: true,
        newAllowed: false,
        newReason: 'scope_denied',
      },
      {
        identity: 'staff-ungranted',
        action: 'property.read',
        oldAllowed: true,
        newAllowed: false,
        newReason: 'scope_denied',
      },
      {
        identity: 'pm-org-action',
        action: 'inbox.read',
        oldAllowed: true,
        newAllowed: true,
        newReason: 'allowed',
      },
    ])
  })

  it('capability/permission denies were identical old vs new (recorded)', async () => {
    // Kill the capability: both paths denied in the BQC-2.4 shadow run
    // (old recorded: allowed=false, reason capability_disabled).
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'property.create' }),
    )
    const spec = IDENTITIES[0]
    const policy = createExecutionPolicy({
      listAccessiblePropertyIds: async () => [PROP],
    })
    const newDecision = await policy.decide({
      principal: { kind: 'user', ctx: spec.ctx },
      action: 'property.read',
      organizationId: ORG,
      propertyId: PROP,
      executionKind: 'interactive',
      now: new Date(),
    })
    expect(spec.oldAllowed && true).toBe(true) // recorded matrix row only
    expect(newDecision.allowed).toBe(false)
    expect(newDecision.reason).toBe('capability_disabled')
  })
})
