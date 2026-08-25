// Identity context — build function.
// Wires identity port, the atomic command store (BQC-3.5), and use cases.
// Per ADR-0001: the composition root calls this and merges useCases into the container.
//
// Readiness/runtime contributions exposed to the composition root:
//   - internal.refreshPolicyStore — BQC-2.2 version-gated strong read of
//     persisted policy state (workers await it before starting; side-effect
//     paths use it for fresh reads, BQC-2.5).
//   - internal.policyAdmin — BQC-2.7 least-privilege policy administration ops.
//   - internal.writeOperatorAudit — BQC-4.5 content-free operator audit sink,
//     injected into the property region-move workflow.

import type { Database } from '#/shared/db'
import type { IdentityPort } from './application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { invitationId, organizationId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import { inviteMember } from './application/use-cases/invite-member'
import { createCustomRole } from './application/use-cases/create-custom-role'
import { updateCustomRole } from './application/use-cases/update-custom-role'
import { deleteCustomRole } from './application/use-cases/delete-custom-role'
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import { listInvitations } from './application/use-cases/list-invitations'
import { resendInvitation } from './application/use-cases/resend-invitation'
import { acceptInvitation } from './application/use-cases/accept-invitation'
import { cancelInvitation } from './application/use-cases/cancel-invitation'
import {
  registerUserAndOrg,
  type RegisterUserAndOrgLogger,
} from './application/use-cases/register-user-and-org'
import { registerUser } from './application/use-cases/register-user'
import { registerInvitedUser } from './application/use-cases/register-invited-user'
import { updateOrganization } from './application/use-cases/update-organization'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { getLogger } from '#/shared/observability/logger'
import type { DataCellExecutionDecision } from '#/shared/routing/data-cell-execution-fence'
import { initPersistedCapabilityPolicyStore } from './infrastructure/policy-store-init'
import { createPolicyAdminOps } from './application/use-cases/policy-admin'
import {
  createPolicyDiagnostic,
  createRegionDiagnostic,
  type PropertyRegionRecord,
} from '#/shared/auth/policy-diagnostic'
import {
  isCoreCapability,
  isBlockedCapability,
  listAllCapabilities,
  checkScopedCapability,
  type Capability,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import { createMerchantAiAuthorization } from './application/use-cases/merchant-ai-authorization'
import { createMerchantAiAuthorizationStore } from './infrastructure/repositories/merchant-ai-authorization.repository'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  MERCHANT_AI_SOURCE_POLICY_ID,
} from './application/dto/merchant-ai-notice.dto'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import {
  setOrganizationPolicy,
  setPropertyPolicy,
  addOrganizationCapability,
  removeOrganizationCapability,
  addPropertyCapability,
  removePropertyCapability,
  isOrgMember,
  getMemberRole,
  loadOrgPolicyState,
} from './infrastructure/repositories/policy-state.repository'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  hasActiveGrant,
  listActiveGrantsForOrg,
} from './infrastructure/repositories/property-access-grant.repository'
import { createPropertyGrantHolderLookup } from './infrastructure/adapters/grant-access-lookup.adapter'
import { writePolicyDecision } from './infrastructure/repositories/policy-decision-audit.repository'
import type { RoutingDecision } from '#/shared/routing/processing-router'
import { isOwnerToken } from '#/shared/domain/roles'
import { createManagerMembershipRepository } from './infrastructure/repositories/manager-membership.repository'

/** Callback invoked after an invitation is accepted.
 * The composition root provides the implementation that creates
 * staff assignments — identity does NOT import staff directly. */
export type OnMemberJoined = (ctx: {
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
  displayName?: string
}) => Promise<void>

type IdentityContextDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  events: EventBus
  clock: () => Date
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (orgId: string) => Promise<void>
  /** Update organization fields via auth provider. */
  updateOrg: (data: Record<string, unknown>) => Promise<void>
  /** Send an invitation email. */
  sendEmail: (params: {
    email: string
    invitedByUsername: string
    organizationName: string
    inviteLink: string
  }) => Promise<void>
  /** Resolve the current organization name from auth context. */
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  /** Base URL for building invitation links. */
  baseUrl: string
  /** Invitation lifetime in ms (INVITATION_EXPIRY_SECONDS in shared/auth/auth). */
  invitationExpiresInMs: number
  /** Delete a user (compensating transaction for registration rollback). */
  deleteUser: (userId: string) => Promise<void>
  /** Logger for the register-user-and-org compensating transaction.
   * Defaults to the shared pino logger; overridable for tests/simulations. */
  logger?: RegisterUserAndOrgLogger
  /**
   * BQC-2.2/2.7/4.4 capability-policy wiring. Identity owns the persisted
   * policy store (readiness), the least-privilege admin ops, and the operator
   * audit sink; the composition root supplies env plus the shared routing
   * primitives (region loader + router decision) as injected deps.
   */
  policy: Readonly<{
    env: CapabilityPolicyEnv
    /** Org-scoped loader of the property's persisted region facts (BQC-4.4). */
    loadPropertyRegion: (
      organizationId: string,
      propertyId: string,
    ) => Promise<PropertyRegionRecord | null>
    /** Suspension recovery bypasses the suspended property gate, then proves tenancy here. */
    propertyBelongsToOrganization: (
      organizationId: string,
      propertyId: string,
    ) => Promise<boolean>
    /** The ProcessingRouter's fresh routing decision for a property. */
    resolveRouting: (propertyId: string) => Promise<RoutingDecision>
    /** The deployment's processing cell (PROCESSING_CELL). */
    cell: string
    /** Fresh process-local Property Data Cell admission for every policy boundary. */
    admitPropertyExecution: (propertyId: string) => Promise<DataCellExecutionDecision>
    /** The cell's logical provider reference (CELL_TARGETS) — never a URL. */
    providerRef: string | null
  }>
  cancelGoogleImportsForUser?: (organizationId: string, userId: string) => Promise<void>
  verifyMerchantAiStepUp?: (input: {
    headers: Headers
    password: string
  }) => Promise<boolean>
}>

/**
 * Content-free operator audit entry (BQC-4.5 region move, mirrors the
 * BQC-2.7 policy_decision_audit writes). Structural mirror of the property
 * context's RegionMoveAuditWriter input — property consumes this via
 * injection, typed by its own port.
 */
type OperatorAuditEntry = Readonly<{
  actorUserId: string
  organizationId: string
  propertyId: string
  action: string
  decision: 'allow' | 'deny'
  reason: string
}>

export const buildIdentityContext = (deps: IdentityContextDeps) => {
  const managerMembershipRepo = createManagerMembershipRepository(deps.db)
  // BQC-3.5: every identity state mutation + fact commits atomically here.
  const commandStore = createAtomicIdentityCommandStore(deps.db, deps.events)

  // BQC-2.2: install the composite capability policy store — env global
  // posture (kill switch / e2e overrides unchanged) + persisted tenant state
  // (allowlist/suspension from the 0014 policy tables). The env seed unions
  // in, so behavior is identical until DB policy rows exist; revocation and
  // suspension take effect within POLICY_REFRESH_INTERVAL_MS.
  const policyStore = initPersistedCapabilityPolicyStore({
    db: deps.db,
    env: deps.policy.env,
    admitPropertyExecution: deps.policy.admitPropertyExecution,
  })
  const merchantAiAuthorization = createMerchantAiAuthorization({
    store: createMerchantAiAuthorizationStore(deps.db, deps.events),
    authorizeManagement: async (input) => {
      const role = await getMemberRole(deps.db, input.organizationId, input.actorUserId)
      if (!role) return false
      if (isOwnerToken(role)) return true
      if (
        !role
          .split(',')
          .map((token) => token.trim().toLowerCase())
          .includes('admin')
      ) {
        return false
      }
      return hasActiveGrant(deps.db, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.actorUserId,
        at: input.now,
      })
    },
    authorize: async (input) => {
      await policyStore.refreshRequired()
      return checkScopedCapability(
        {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
        },
        input.capability,
      ).allowed
    },
    verifyStepUp: async (input) =>
      input.requestHeaders !== undefined &&
      deps.verifyMerchantAiStepUp !== undefined &&
      deps.verifyMerchantAiStepUp({
        headers: input.requestHeaders,
        password: input.proof,
      }),
    clock: deps.clock,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
    redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  })

  // BQC-2.7: policy administration operations (least-privilege, audited).
  // Identity-owned persistence bound here — application layer stays
  // orchestration-only (boundary rule).
  const policyDiagnostic = createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(deps.db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(deps.db, input),
  })
  const policyAdmin = createPolicyAdminOps({
    clock: deps.clock,
    isCoreCapability: (cap) => isCoreCapability(cap as Capability),
    isBlockedCapability: (cap) => isBlockedCapability(cap as Capability),
    listAllCapabilities,
    policyVersion: EXECUTION_POLICY_VERSION,
    explainPolicyDecision: (input) => policyDiagnostic(input),
    // BQC-4.4: content-free region diagnostic — the org-scoped loader treats
    // cross-org properties as missing; the router reports the fresh decision;
    // cell + provider ref are logical identifiers, never URLs.
    getRegionDiagnostic: createRegionDiagnostic({
      loadPropertyRegion: deps.policy.loadPropertyRegion,
      resolveRouting: deps.policy.resolveRouting,
      cell: deps.policy.cell,
      providerRef: deps.policy.providerRef,
    }),
    refreshPolicy: () => policyStore.refresh(),
    setOrganizationPolicy: (input) => setOrganizationPolicy(deps.db, input),
    setPropertyPolicy: (input) => setPropertyPolicy(deps.db, input),
    propertyBelongsToOrganization: deps.policy.propertyBelongsToOrganization,
    addOrganizationCapability: (orgId, cap, by) =>
      addOrganizationCapability(deps.db, orgId, cap, by),
    removeOrganizationCapability: (orgId, cap) =>
      removeOrganizationCapability(deps.db, orgId, cap),
    addPropertyCapability: (propertyId, cap, by) =>
      addPropertyCapability(deps.db, propertyId, cap, by),
    removePropertyCapability: (propertyId, cap) =>
      removePropertyCapability(deps.db, propertyId, cap),
    isOrgMember: (orgId, uid) => isOrgMember(deps.db, orgId, uid),
    loadOrgPolicyState: (orgId) => loadOrgPolicyState(deps.db, orgId),
    grantPropertyAccess: (input) => grantPropertyAccess(deps.db, input),
    revokePropertyAccess: (input) => revokePropertyAccess(deps.db, input),
    listActiveGrantsForOrg: (orgId, at) => listActiveGrantsForOrg(deps.db, orgId, at),
    writePolicyDecision: (entry) => writePolicyDecision(deps.db, entry),
  })

  // BQC-4.5: content-free operator audit sink for the property region-move
  // workflow — exposed for injection so the property context never imports
  // identity infrastructure.
  const writeOperatorAudit = (entry: OperatorAuditEntry) =>
    writePolicyDecision(deps.db, {
      actorType: 'operator',
      actorId: entry.actorUserId,
      organizationId: entry.organizationId,
      propertyId: entry.propertyId,
      action: entry.action,
      capability: null,
      executionKind: 'operator',
      decision: entry.decision,
      reason: entry.reason.slice(0, 200),
      policyVersion: EXECUTION_POLICY_VERSION,
      correlationId: null,
    })

  const grantInvitationPropertyAccess = async (
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
    }>,
  ): Promise<void> => {
    const at = deps.clock()
    if (
      await hasActiveGrant(deps.db, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.userId,
        at,
      })
    ) {
      return
    }
    try {
      await grantPropertyAccess(deps.db, {
        ...input,
        source: 'invitation',
        createdBy: `invitation:${input.userId}`,
      })
    } catch (error) {
      // Concurrent/retried invitation acceptance converges on the same active
      // grant; only suppress the unique race after proving the row exists.
      const active = await hasActiveGrant(deps.db, { ...input, at: deps.clock() })
      if (!active) throw error
    }
  }
  const hasActivePropertyGrant = (
    tx: Database,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => hasActiveGrant(tx, input)

  const useCases = {
    inviteMember: inviteMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      idGen: () => invitationId(randomUUID()),
      invitationExpiresInMs: deps.invitationExpiresInMs,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.getOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    updateMemberRole: updateMemberRole({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
    }),
    removeMember: removeMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      cancelGoogleImportsForUser: deps.cancelGoogleImportsForUser,
    }),
    listInvitations: listInvitations({ identity: deps.identityPort }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.getOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    acceptInvitation: acceptInvitation({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
    }),
    cancelInvitation: cancelInvitation({
      commandStore,
      clock: deps.clock,
    }),
    registerUserAndOrg: registerUserAndOrg({
      signUp: deps.signUp,
      setActiveOrg: deps.setActiveOrg,
      clock: deps.clock,
      idGen: () => organizationId(randomUUID()),
      commandStore,
      deleteUser: deps.deleteUser,
      logger:
        deps.logger ??
        ({
          error: (obj: object, msg?: string) => getLogger().error(obj, msg),
        } satisfies RegisterUserAndOrgLogger),
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
    registerInvitedUser: registerInvitedUser({
      commandStore,
      signUp: deps.identityPort.signUp,
      deleteUser: deps.identityPort.deleteUser,
      runOnAccepted: deps.identityPort.runOnAcceptInvitation,
      clock: deps.clock,
      logger:
        deps.logger ??
        ({
          error: (obj: object, msg?: string) => getLogger().error(obj, msg),
        } satisfies RegisterUserAndOrgLogger),
    }),
    updateOrganization: updateOrganization({
      updateOrg: deps.updateOrg,
    }),
    createCustomRole: createCustomRole({ identity: deps.identityPort }),
    updateCustomRole: updateCustomRole({ identity: deps.identityPort }),
    deleteCustomRole: deleteCustomRole({ identity: deps.identityPort }),
    merchantAiAuthorization,
  } as const

  return {
    publicApi: {
      listActiveManagers: managerMembershipRepo.listActiveManagers,
    } as const,
    internal: {
      repos: {} as const,
      useCases,
      // BQC-2.7: least-privilege policy administration operations.
      policyAdmin,
      // BQC-2.2: version-gated strong read of persisted policy state
      // (readiness contribution — the worker awaits it before starting).
      refreshPolicyStore: policyStore.refresh,
      refreshPolicyStoreRequired: policyStore.refreshRequired,
      // BQC-7.3 (versions.policy_store): cheap in-memory read of the current
      // persisted policy_version for the OperationsSnapshot (null when only
      // the env seed is present — no DB round-trip).
      policyStoreVersion: policyStore.currentVersion,
      // BQC-4.5: operator audit sink for the property region-move workflow.
      writeOperatorAudit,
      grantInvitationPropertyAccess,
      // Identity owns the grant table; callers supply their authorization
      // transaction so the grant read participates in the same commit check.
      hasActivePropertyGrant,
      // Property-scoped recipient resolution for other contexts (notification
      // fan-out). Identity owns the grant table, so the read lives here.
      propertyAccessHolders: createPropertyGrantHolderLookup(deps.db),
    },
  } as const
}
