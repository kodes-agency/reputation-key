// BQC-2.4 — synthetic old-vs-new decision comparison (shadow record).
//
// Phase BQC-2 §2.4: "Record old/new decisions for synthetic identities, then
// delete the old path." This test runs the pre-cutover decision path
// (checkAuthorization — capability + permission + the never-wired
// assignedPropertyIds layer) against the ExecutionPolicy for a synthetic
// identity matrix, records both decision tables, and asserts the only
// allowed disagreement class: the new policy denies exactly where the old
// path was silently fail-open on property scope (assigned-scope role, target
// property, no grant). Never permit on disagreement — verified by the
// deny-superset assertion.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkAuthorization } from './authorization-policy'
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
  },
  {
    label: 'pm-granted',
    ctx: makeCtx('pmg', 'PropertyManager', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: true,
  },
  {
    label: 'pm-ungranted',
    ctx: makeCtx('pmu', 'PropertyManager', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: false,
  },
  {
    label: 'staff-ungranted',
    ctx: makeCtx('stfu', 'Staff', 'assigned-properties'),
    propertyScoped: true,
    hasGrant: false,
  },
  {
    label: 'pm-org-action',
    ctx: makeCtx('pmo', 'PropertyManager', 'assigned-properties'),
    propertyScoped: false,
    hasGrant: false,
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

describe('old-vs-new synthetic decision comparison (BQC-2.4)', () => {
  it('records both decision tables; new denies exactly the old fail-open cases', async () => {
    const rows: Row[] = []
    for (const spec of IDENTITIES) {
      const action: Permission = spec.propertyScoped ? 'property.read' : 'inbox.read'
      const propertyId = spec.propertyScoped ? PROP : undefined

      // OLD path (production pre-BQC-2.4): capability + permission; the
      // assignedPropertyIds layer was never wired, so property scope was
      // silently fail-open at the boundary.
      const oldDecision = checkAuthorization({
        actor: spec.ctx,
        action,
        capability: 'property.create',
        propertyId,
      })

      // NEW path (ExecutionPolicy): grant-backed scope.
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
        oldAllowed: oldDecision.allowed,
        newAllowed: newDecision.allowed,
        newReason: newDecision.reason,
      })
    }

    // ── The shadow record (also asserted structurally below) ──────────
    // admin-orgwide  old=ALLOW new=ALLOW  (org scope, no grant needed)
    // pm-granted     old=ALLOW new=ALLOW  (grant present)
    // pm-ungranted   old=ALLOW new=DENY   (old fail-open; new scope_denied)
    // staff-ungranted old=ALLOW new=DENY  (old fail-open; new scope_denied)
    // pm-org-action  old=ALLOW new=ALLOW  (org-level action, no property)
    for (const row of rows) {
      // New never permits where old denied.
      if (!row.oldAllowed) expect(row.newAllowed).toBe(false)
    }

    const disagreements = rows.filter((r) => r.oldAllowed !== r.newAllowed)
    // Every disagreement is an old-fail-open the new policy closes.
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

  it('capability/permission denies are identical old vs new (no shadow delta)', async () => {
    // Kill the capability: both paths must deny; no disagreement allowed.
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'property.create' }),
    )
    const spec = IDENTITIES[0]
    const oldDecision = checkAuthorization({
      actor: spec.ctx,
      action: 'property.read',
      capability: 'property.create',
      propertyId: PROP,
    })
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
    expect(oldDecision.allowed).toBe(false)
    expect(newDecision.allowed).toBe(false)
    expect(newDecision.reason).toBe('capability_disabled')
  })
})
