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
  PolicyAdminRegionDiagnostic,
} from '../ports/property-access-grant.port'
import type {
  PolicyAdminAuditEntry,
  PolicyAdminCommandStore,
} from '../ports/policy-admin-command-store.port'
import type { Permission } from '#/shared/domain/permissions'

// ── Injected persistence + policy surface (bound at composition) ─────

export type PolicyAdminDeps = Readonly<{
  // BQC-5.3: runtime-neutral decisions — time comes from the injected
  // clock, never an ambient wall clock (ADR 0017).
  clock: () => Date
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
  // BQC-4.4: content-free region diagnostic (shared/auth/policy-diagnostic —
  // region facts + router decision + cell/provider ref; no URLs, no content).
  getRegionDiagnostic: (input: {
    organizationId: string
    propertyId: string
  }) => Promise<PolicyAdminRegionDiagnostic>
  /** Strong-read the persisted capability snapshot after tenant policy mutations. */
  refreshPolicy: () => Promise<void>
  // Identity-owned transaction boundary. Policy/grant state, its version
  // bump, and the required audit evidence commit together here.
  commandStore: PolicyAdminCommandStore
  loadOrgPolicyState: (organizationId: string) => Promise<OrgPolicyState>
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
  listActiveGrantsForOrg: (
    organizationId: string,
    at: Date,
  ) => Promise<ReadonlyArray<PropertyAccessGrantRecord>>
  writePolicyDecision: (entry: PolicyAdminAuditEntry) => Promise<void>
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
  await deps.writePolicyDecision(auditEntry(deps, input))
}

function auditEntry(
  deps: PolicyAdminDeps,
  input: Readonly<{
    organizationId: string
    propertyId?: string | null
    action: string
    capability?: string | null
    reason: string
    actorUserId: string
  }>,
): PolicyAdminAuditEntry {
  return {
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
  }
}

// ── The operations ───────────────────────────────────────────────────

export function createPolicyAdminOps(deps: PolicyAdminDeps) {
  async function getOrgPolicyState(organizationId: string) {
    const [state, grants] = await Promise.all([
      deps.loadOrgPolicyState(organizationId),
      deps.listActiveGrantsForOrg(organizationId, deps.clock()),
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

    await deps.commandStore.setOrganizationCapability({
      organizationId: input.organizationId,
      capability: input.capability,
      enabled: input.enabled,
      createdBy: input.actorUserId,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        action: input.enabled ? 'policy.allowlist.set' : 'policy.allowlist.clear',
        capability: input.capability,
        reason: input.reason,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
  }

  async function setPropertyCapability(
    input: Readonly<{
      organizationId: string
      propertyId: string
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
    await deps.commandStore.setPropertyCapability({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      capability: input.capability,
      enabled: input.enabled,
      createdBy: input.actorUserId,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: input.enabled
          ? 'policy.property.allowlist.set'
          : 'policy.property.allowlist.clear',
        capability: input.capability,
        reason: input.reason,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
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
    await deps.commandStore.setOrganizationSuspension({
      organizationId: input.organizationId,
      suspendedAt: input.suspend ? input.now : null,
      suspendedReason: input.suspend ? input.reason : null,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        action: input.suspend ? 'policy.org.suspend' : 'policy.org.unsuspend',
        reason: `${input.reason} (${input.ticketRef})`,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
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
    await deps.commandStore.setPropertySuspension({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      suspendedAt: input.suspend ? input.now : null,
      suspendedReason: input.suspend ? input.reason : null,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: input.suspend ? 'policy.property.suspend' : 'policy.property.unsuspend',
        reason: `${input.reason} (${input.ticketRef})`,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
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
    await deps.commandStore.grantPropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      source: 'operator',
      createdBy: input.actorUserId,
      expiresAt: input.expiresAt,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: 'policy.grant',
        reason: `${input.reason} (${input.ticketRef})`,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
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
    await deps.commandStore.revokePropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      reason: input.reason,
      audit: auditEntry(deps, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: 'policy.revoke',
        reason: input.reason,
        actorUserId: input.actorUserId,
      }),
    })
    await deps.refreshPolicy()
    await deps.reconcileResponsibleManagerEligibility?.(
      input.organizationId,
      input.userId,
      input.actorUserId,
    )
  }

  // BQC-4.4: read-only region diagnostic. Every read writes an operator
  // audit outcome (content-free machine reason) — support access is
  // least-privilege AND audited.
  async function getRegionDiagnostic(
    input: Readonly<{
      organizationId: string
      propertyId: string
      actorUserId: string
    }>,
  ): Promise<PolicyAdminRegionDiagnostic> {
    const diagnostic = await deps.getRegionDiagnostic({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
    await auditOp(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: 'policy.region.diagnostic',
      reason: `region diagnostic: ${diagnostic.processable ? 'processable' : diagnostic.blockedReason}`,
      actorUserId: input.actorUserId,
    })
    return diagnostic
  }

  return {
    getOrgPolicyState,
    setOrgCapability,
    setPropertyCapability,
    setOrgSuspension,
    setPropertySuspension,
    grantPropertyAccessOp,
    revokePropertyAccessOp,
    getRegionDiagnostic,
    explainPolicyDecision: deps.explainPolicyDecision,
  }
}

// ── Property capability provisioning (BQC-2.7) ───────────────────────
//
// A property's allowlist is INDEPENDENT of its organization's: an org can hold
// the full beta capability set while one of its properties holds none, and an
// empty property_capability set denies every non-core capability
// (`property_not_allowlisted`). Provisioning copies the organization's set
// onto the property — the Google import path does it for every property it
// creates, and the operator command repairs drift after the fact.
//
// No extra policy_decision_audit row is written here: the operator command
// runs through the BQC-7.5 harness, which audits the invocation (action
// 'system:ops', allow WITH the operator reason), and every granted row keeps
// its own provenance in property_capability.created_by. The import path's
// provenance is the initiating user id it passes as createdBy.
//
// Pure orchestration (boundary rule): the reads, the idempotent grant and the
// snapshot refresh are all injected.

export type PropertyCapabilityProvisioningDeps = Readonly<{
  listOrganizationCapabilities: (organizationId: string) => Promise<ReadonlyArray<string>>
  listPropertyCapabilities: (propertyId: string) => Promise<ReadonlyArray<string>>
  /** The property's organization — null when the property is absent. */
  getPropertyOrganizationId: (propertyId: string) => Promise<string | null>
  /** Active, non-deleted properties of the organization. */
  listProvisionablePropertyIds: (organizationId: string) => Promise<ReadonlyArray<string>>
  /**
   * Idempotent grant of the organization's allowlist onto one property —
   * returns exactly the capabilities it added (empty when already complete).
   */
  provisionPropertyCapabilities: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      createdBy?: string
    }>,
  ) => Promise<ReadonlyArray<string>>
  /** Strong-read the persisted capability snapshot after a grant. */
  refreshPolicy: () => Promise<void>
}>

export type PropertyCapabilityGap = Readonly<{
  propertyId: string
  /** Capabilities currently allowlisted for the property. */
  capabilities: ReadonlyArray<string>
  /** Organization capabilities the property does NOT hold. */
  missing: ReadonlyArray<string>
}>

export type PropertyCapabilityReport = Readonly<{
  organizationId: string
  organizationCapabilities: ReadonlyArray<string>
  properties: ReadonlyArray<PropertyCapabilityGap>
}>

export type PropertyCapabilitySyncResult = Readonly<{
  organizationId: string
  /** One entry per property that actually gained capabilities. */
  granted: ReadonlyArray<
    Readonly<{ propertyId: string; capabilities: ReadonlyArray<string> }>
  >
}>

export function createPropertyCapabilityProvisioning(
  deps: PropertyCapabilityProvisioningDeps,
) {
  /** The properties an operation targets — tenant-checked for a single id. */
  async function targets(
    organizationId: string,
    propertyId: string | null,
  ): Promise<ReadonlyArray<string>> {
    if (propertyId === null) return deps.listProvisionablePropertyIds(organizationId)
    if ((await deps.getPropertyOrganizationId(propertyId)) !== organizationId) {
      throw new Error('property not found in organization')
    }
    return [propertyId]
  }

  async function report(
    input: Readonly<{ organizationId: string; propertyId: string | null }>,
  ): Promise<PropertyCapabilityReport> {
    const organizationCapabilities = await deps.listOrganizationCapabilities(
      input.organizationId,
    )
    const propertyIds = await targets(input.organizationId, input.propertyId)
    // Sequential: an operator report over a whole organization must not open
    // one pooled connection per property.
    const properties: PropertyCapabilityGap[] = []
    for (const id of propertyIds) {
      const capabilities = await deps.listPropertyCapabilities(id)
      const held = new Set(capabilities)
      properties.push({
        propertyId: id,
        capabilities,
        missing: organizationCapabilities.filter((capability) => !held.has(capability)),
      })
    }
    return {
      organizationId: input.organizationId,
      organizationCapabilities,
      properties,
    }
  }

  async function sync(
    input: Readonly<{
      organizationId: string
      propertyId: string | null
      createdBy: string
    }>,
  ): Promise<PropertyCapabilitySyncResult> {
    const propertyIds = await targets(input.organizationId, input.propertyId)
    const granted: Array<{ propertyId: string; capabilities: ReadonlyArray<string> }> = []
    for (const id of propertyIds) {
      const capabilities = await deps.provisionPropertyCapabilities({
        organizationId: input.organizationId,
        propertyId: id,
        createdBy: input.createdBy,
      })
      if (capabilities.length > 0) granted.push({ propertyId: id, capabilities })
    }
    if (granted.length > 0) await deps.refreshPolicy()
    return { organizationId: input.organizationId, granted }
  }

  /**
   * The import path's provisioning port: grant the organization's allowlist to
   * a property the import just created. Idempotent — a replayed effect grants
   * nothing and refreshes nothing.
   */
  async function provisionCreatedProperty(
    input: Readonly<{
      organizationId: string
      propertyId: string
      createdBy: string
    }>,
  ): Promise<void> {
    const granted = await deps.provisionPropertyCapabilities(input)
    if (granted.length > 0) await deps.refreshPolicy()
  }

  return { report, sync, provisionCreatedProperty }
}

export type PropertyCapabilityProvisioning = ReturnType<
  typeof createPropertyCapabilityProvisioning
>

// ── ops:property-capabilities command core ───────────────────────────
//
// The command's parse + action live here (with their unit tests); scripts/ is
// outside tsconfig/eslint, so scripts/ops/property-capabilities.ts is wiring
// only — the same split as the operator-command harness itself.

export type PropertyCapabilityCommand = Readonly<{
  action: 'list' | 'sync'
  /** null = every active, non-deleted property in the organization (--all). */
  propertyId: string | null
}>

const PROPERTY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parse the command's own positionals (the harness strips its flags first):
 * `<list|sync> <propertyId>`, or `<list|sync>` with --all for the whole
 * organization. Returns null on a malformed invocation — the script prints
 * its usage and exits 1.
 */
export function parsePropertyCapabilityCommand(
  positionals: ReadonlyArray<string>,
  all: boolean,
): PropertyCapabilityCommand | null {
  const [action, propertyId, ...extra] = positionals
  if (extra.length > 0) return null
  if (action !== 'list' && action !== 'sync') return null
  if (all) return propertyId === undefined ? { action, propertyId: null } : null
  if (propertyId === undefined || !PROPERTY_ID_RE.test(propertyId)) return null
  return { action, propertyId }
}

/** The subset of the harness context/io this action reads (structural). */
type PropertyCapabilityOperatorContext = Readonly<{
  operatorId: string
  organizationId?: string
  dryRun: boolean
}>
type PropertyCapabilityOperatorIO = Readonly<{ out: (line: string) => void }>

/**
 * The ops:property-capabilities action — structurally compatible with the
 * harness's OperatorAction. `list` reports the property allowlist against its
 * organization's; `sync` grants what is missing, and REPORTS WITHOUT WRITING
 * until --apply (the harness sets ctx.dryRun for a mutation invoked without
 * it).
 */
export function createPropertyCapabilityOperatorAction(
  ops: PropertyCapabilityProvisioning,
  command: PropertyCapabilityCommand,
  commandName: string,
): (
  ctx: PropertyCapabilityOperatorContext,
  args: unknown,
  io: PropertyCapabilityOperatorIO,
) => Promise<void> {
  return async (ctx, _args, io) => {
    const organizationId = ctx.organizationId as string
    if (command.action === 'list' || ctx.dryRun) {
      const report = await ops.report({
        organizationId,
        propertyId: command.propertyId,
      })
      io.out(
        JSON.stringify(
          { action: command.action === 'list' ? 'list' : 'would_sync', ...report },
          null,
          2,
        ),
      )
      if (command.action === 'sync') {
        io.out(`re-run with --reason <text> --apply ${commandName}`)
      }
      return
    }
    const result = await ops.sync({
      organizationId,
      propertyId: command.propertyId,
      createdBy: ctx.operatorId,
    })
    io.out(JSON.stringify({ action: 'sync', ...result }, null, 2))
  }
}
