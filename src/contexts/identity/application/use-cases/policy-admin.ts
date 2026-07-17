// BQC-2.7 — policy administration use cases.
//
// Authenticated, least-privilege policy operations (phase BQC-2 §2.7):
// allowlist, suspension, grant, revocation. Every operation requires a
// reason (and a ticket/reference where applicable) and writes a content-free
// audit outcome to policy_decision_audit (actorType/executionKind
// 'operator'). Validation rules:
//   - allowlist: only known, non-core, non-blocked capabilities;
//   - suspension: reason + ticket/reference required;
//   - grant: reason + ticket required, org membership required, optional
//     expiry for temporary access;
//   - revoke: reason required.
// Global kill switches stay env-managed (BQC-0.4); org-level kill is org
// suspension. The read-only diagnostic lives in shared/auth/policy-diagnostic
// (decision layer) and is re-exported here via deps.
//
// Pure orchestration (boundary rule): capability classification, policy
// version, diagnostic, and persistence are all injected — the composition
// root binds them.

import type {
  PropertyAccessGrantRecord,
  OrgPolicyState,
  PolicyAdminExplanation,
} from '../ports/property-access-grant.port'
import type { Permission } from '#/shared/domain/permissions'

// ── Injected persistence + policy surface (bound at composition) ─────

export type PolicyAdminDeps = Readonly<{
  // Policy functions (decision layer, shared/auth — bound at composition).
  isCoreCapability: (capability: string) => boolean
  isBlockedCapability: (capability: string) => boolean
  listAllCapabilities: () => ReadonlyArray<string>
  policyVersion: string
  explainPolicyDecision: (input: {
    organizationId: string
    action: Permission
    propertyId?: string
    userId: string
    now: Date
  }) => Promise<PolicyAdminExplanation>
  // Identity repositories.
  setOrganizationPolicy: (input: {
    organizationId: string
    cohort?: string
    suspendedAt?: Date | null
    suspendedReason?: string | null
  }) => Promise<void>
  setPropertyPolicy: (input: {
    propertyId: string
    suspendedAt?: Date | null
    suspendedReason?: string | null
  }) => Promise<void>
  addOrganizationCapability: (
    organizationId: string,
    capability: string,
    createdBy?: string,
  ) => Promise<void>
  removeOrganizationCapability: (
    organizationId: string,
    capability: string,
  ) => Promise<void>
  isOrgMember: (organizationId: string, userId: string) => Promise<boolean>
  loadOrgPolicyState: (organizationId: string) => Promise<OrgPolicyState>
  grantPropertyAccess: (input: {
    organizationId: string
    propertyId: string
    userId: string
    source: 'operator' | 'migration' | 'invitation'
    createdBy?: string
    expiresAt?: Date
  }) => Promise<PropertyAccessGrantRecord>
  revokePropertyAccess: (input: {
    organizationId: string
    propertyId: string
    userId: string
    reason?: string
  }) => Promise<boolean>
  listActiveGrantsForOrg: (
    organizationId: string,
    at: Date,
  ) => Promise<ReadonlyArray<PropertyAccessGrantRecord>>
  writePolicyDecision: (
    entry: Readonly<{
      actorType: string
      actorId: string | null
      organizationId: string | null
      propertyId: string | null
      action: string
      capability: string | null
      executionKind: string
      decision: string
      reason: string
      policyVersion: string
      correlationId: string | null
    }>,
  ) => Promise<void>
}>

// ── Shared validation + audit ────────────────────────────────────────

function requireReason(reason: string): void {
  if (reason.trim().length < 3) throw new Error('reason is required (min 3 chars)')
}

function requireTicket(ticketRef: string): void {
  if (ticketRef.trim().length < 2) throw new Error('ticket/reference is required')
}

async function auditOp(
  deps: PolicyAdminDeps,
  input: Readonly<{
    organizationId: string
    propertyId?: string | null
    action: string
    capability?: string | null
    reason: string
    actorUserId: string
  }>,
): Promise<void> {
  await deps.writePolicyDecision({
    actorType: 'operator',
    actorId: input.actorUserId,
    organizationId: input.organizationId,
    propertyId: input.propertyId ?? null,
    action: input.action,
    capability: input.capability ?? null,
    executionKind: 'operator',
    decision: 'allow',
    reason: input.reason.slice(0, 200),
    policyVersion: deps.policyVersion,
    correlationId: null,
  })
}

// ── The operations ───────────────────────────────────────────────────

export function createPolicyAdminOps(deps: PolicyAdminDeps) {
  async function getOrgPolicyState(organizationId: string) {
    const [state, grants] = await Promise.all([
      deps.loadOrgPolicyState(organizationId),
      deps.listActiveGrantsForOrg(organizationId, new Date()),
    ])
    return { ...state, grants }
  }

  async function setOrgCapability(
    input: Readonly<{
      organizationId: string
      capability: string
      enabled: boolean
      reason: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    if (!deps.listAllCapabilities().includes(input.capability)) {
      throw new Error(`unknown capability '${input.capability}'`)
    }
    if (deps.isCoreCapability(input.capability)) {
      throw new Error(`capability '${input.capability}' is core — no allowlist needed`)
    }
    if (deps.isBlockedCapability(input.capability)) {
      throw new Error(`capability '${input.capability}' is blocked — never allowlistable`)
    }
    requireReason(input.reason)

    if (input.enabled) {
      await deps.addOrganizationCapability(
        input.organizationId,
        input.capability,
        input.actorUserId,
      )
    } else {
      await deps.removeOrganizationCapability(input.organizationId, input.capability)
    }
    await auditOp(deps, {
      organizationId: input.organizationId,
      action: input.enabled ? 'policy.allowlist.set' : 'policy.allowlist.clear',
      capability: input.capability,
      reason: input.reason,
      actorUserId: input.actorUserId,
    })
  }

  async function setOrgSuspension(
    input: Readonly<{
      organizationId: string
      suspend: boolean
      reason: string
      ticketRef: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    requireReason(input.reason)
    requireTicket(input.ticketRef)
    await deps.setOrganizationPolicy({
      organizationId: input.organizationId,
      suspendedAt: input.suspend ? input.now : null,
      suspendedReason: input.suspend ? input.reason : null,
    })
    await auditOp(deps, {
      organizationId: input.organizationId,
      action: input.suspend ? 'policy.org.suspend' : 'policy.org.unsuspend',
      reason: `${input.reason} (${input.ticketRef})`,
      actorUserId: input.actorUserId,
    })
  }

  async function setPropertySuspension(
    input: Readonly<{
      organizationId: string
      propertyId: string
      suspend: boolean
      reason: string
      ticketRef: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    requireReason(input.reason)
    requireTicket(input.ticketRef)
    await deps.setPropertyPolicy({
      propertyId: input.propertyId,
      suspendedAt: input.suspend ? input.now : null,
      suspendedReason: input.suspend ? input.reason : null,
    })
    await auditOp(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: input.suspend ? 'policy.property.suspend' : 'policy.property.unsuspend',
      reason: `${input.reason} (${input.ticketRef})`,
      actorUserId: input.actorUserId,
    })
  }

  async function grantPropertyAccessOp(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      reason: string
      ticketRef: string
      expiresAt?: Date
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    requireReason(input.reason)
    requireTicket(input.ticketRef)
    if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) {
      throw new Error('expiresAt must be in the future for temporary access')
    }
    if (!(await deps.isOrgMember(input.organizationId, input.userId))) {
      throw new Error(`user ${input.userId} is not a member of this organization`)
    }
    await deps.grantPropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      source: 'operator',
      createdBy: input.actorUserId,
      expiresAt: input.expiresAt,
    })
    await auditOp(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: 'policy.grant',
      reason: `${input.reason} (${input.ticketRef})`,
      actorUserId: input.actorUserId,
    })
  }

  async function revokePropertyAccessOp(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      reason: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    requireReason(input.reason)
    await deps.revokePropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      reason: input.reason,
    })
    await auditOp(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: 'policy.revoke',
      reason: input.reason,
      actorUserId: input.actorUserId,
    })
  }

  return {
    getOrgPolicyState,
    setOrgCapability,
    setOrgSuspension,
    setPropertySuspension,
    grantPropertyAccessOp,
    revokePropertyAccessOp,
    explainPolicyDecision: deps.explainPolicyDecision,
  }
}
