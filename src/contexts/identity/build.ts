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
//   - internal.organizationLifecycleRuntime — named lifecycle/export control,
//     content-free diagnostics, and contributor-gated maintenance services.

import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { IdentityPort } from './application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { invitationId, organizationId } from '#/shared/domain/ids'
import { inviteMember } from './application/use-cases/invite-member'
import { createCustomRole } from './application/use-cases/create-custom-role'
import { updateCustomRole } from './application/use-cases/update-custom-role'
import { deleteCustomRole } from './application/use-cases/delete-custom-role'
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import { leaveOrganization } from './application/use-cases/leave-organization'
import type { MemberOffboardingPort } from './application/ports/member-offboarding.port'
import { identityError } from './domain/errors'
import { listInvitations } from './application/use-cases/list-invitations'
import { resendInvitation } from './application/use-cases/resend-invitation'
import { acceptInvitation } from './application/use-cases/accept-invitation'
import { cancelInvitation } from './application/use-cases/cancel-invitation'
import { registerUserAndOrg } from './application/use-cases/register-user-and-org'
import { registerUser } from './application/use-cases/register-user'
import { registerInvitedUser } from './application/use-cases/register-invited-user'
import { recoverInvitedRegistrations } from './application/use-cases/recover-invited-registrations'
import { updateOrganization } from './application/use-cases/update-organization'
import type { AuthSessionPort } from './application/ports/auth-session.port'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { createInvitedRegistrationStore } from './infrastructure/invited-registration-store'
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
  getMemberRole,
  loadOrgPolicyState,
} from './infrastructure/repositories/policy-state.repository'
import {
  grantPropertyAccess,
  revokeAllPropertyAccessForUser,
  hasActiveGrant,
  listActiveGrantsForOrg,
} from './infrastructure/repositories/property-access-grant.repository'
import { createPropertyGrantHolderLookup } from './infrastructure/adapters/grant-access-lookup.adapter'
import { writePolicyDecision } from './infrastructure/repositories/policy-decision-audit.repository'
import { createPostgresPolicyAdminCommandStore } from './infrastructure/policy-admin-command-store'
import { createOrganizationLifecycle } from './application/use-cases/organization-lifecycle'
import {
  reactivateOrganization,
  type ReactivateOrganizationInput,
} from './application/use-cases/reactivate-organization'
import {
  createDefaultOrganizationReactivationReadiness,
  type OrganizationReactivationReadinessDeps,
} from './infrastructure/organization-reactivation-readiness'
import { createOrganizationLifecycleCommandStore } from './infrastructure/organization-lifecycle-command-store'
import {
  createOrganizationLifecycleCoordinator,
  type BeginIrreversibleOrganizationPurgeInput,
  type CancelPendingOrganizationPurgeInput,
  type WaiveOrganizationRecoveryInput,
} from './application/use-cases/advance-organization-lifecycle'
import { createOrganizationExportService } from './application/use-cases/organization-export'
import type { OrganizationLifecycleContributor } from './application/ports/organization-lifecycle-contributor.port'
import type {
  OrganizationExportArchiveWriter,
  OrganizationExportStorage,
} from './application/ports/organization-export.port'
import type { OrganizationExportContributor } from './application/ports/organization-export-contributor.port'
import {
  ORGANIZATION_LIFECYCLE_CONTEXTS,
  type OrganizationLifecycleContext,
} from './domain/organization-lifecycle'
import { createOrganizationExportRepository } from './infrastructure/organization-export.repository'
import { createIdentityOrganizationExportContributor } from './infrastructure/identity-organization-export-contributor'
import type { RoutingDecision } from '#/shared/routing/processing-router'
import { createManagerMembershipRepository } from './infrastructure/repositories/manager-membership.repository'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import {
  canForContext,
  scopeForPermission,
  type Permission,
} from '#/shared/domain/permissions'
import {
  decideCurrentManagerPropertyAuthorities,
  decideCurrentManagerPropertyAuthority,
  decideCurrentMemberPropertyAuthority,
  decideMemberPropertyAuthority,
  type ManagerPropertyAuthorityRequirement,
  type MemberPropertyAuthorityDatabase,
} from './infrastructure/repositories/member-property-authority'
import type {
  IdentityAccountAdminAuthorityPublicApi,
  IdentityManagerFactsPublicApi,
  IdentityPublicApi,
  IdentityRequestApi,
} from './application/public-api'

/** Callback invoked after an invitation is accepted.
 * The composition root provides the implementation that creates
 * staff assignments — identity does NOT import staff directly. */
export type OnMemberJoined = (ctx: {
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
  displayName?: string
}) => Promise<void>

/** Exactly the reactivation probes composition must supply, or none at all. */
export type OrganizationReactivationProbeBindings = OrganizationReactivationReadinessDeps

/**
 * Reviewed cross-context bindings for the Organization lifecycle control
 * plane. Partial contributor sets are accepted only as an explicit
 * composition-readiness state; they can never execute a lifecycle phase or
 * generate an export.
 */
export type IdentityOrganizationLifecycleComposition = Readonly<{
  lifecycleContributors?: readonly OrganizationLifecycleContributor[]
  supportAuthorization?: import('./application/ports/organization-lifecycle-contributor.port').OrganizationLifecycleSupportAuthorization
  /**
   * Cross-context export contributors; Identity supplies its own reviewed
   * owner and rejects a supplied `identity` entry.
   *
   * LIF-01-T11: this is deliberately a sibling of `organizationExport` rather
   * than a field inside it. A contributor set reads nothing and writes nothing
   * on its own, so composing all sixteen is not an activation — it only lets
   * readiness report the truth about coverage. Egress still requires the
   * `organizationExport` bundle below, which stays all-or-nothing.
   */
  exportContributors?: readonly OrganizationExportContributor[]
  /**
   * LIF-01-T18: the three cross-context readiness probes reactivation needs.
   *
   * Absent means no reactivation command exists on the runtime at all — the
   * same all-or-nothing posture the lifecycle coordinator uses. Composing them
   * activates nothing on its own either: every probe is a read, and the
   * command still refuses while any check or deliberate action is missing.
   */
  reactivationProbes?: OrganizationReactivationProbeBindings
  organizationExport?: Readonly<{
    archiveWriter: OrganizationExportArchiveWriter
    storage: OrganizationExportStorage
    deriveRetrievalSecret: (input: {
      requestId: string
      operationId: string
    }) => Uint8Array
  }>
}>

type IdentityContextDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  events: EventBus
  clock: Clock
  idGen: () => string
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /**
   * ARC-03-T13: the authenticated session, injected as a port. The four
   * operations the root used to perform inline against the better-auth process
   * singleton (set active org, update org, read org name, verify password) are
   * now one Identity-owned contract.
   */
  authSession: AuthSessionPort
  /** Send an invitation email. */
  sendEmail: (params: {
    email: string
    invitedByUsername: string
    organizationName: string
    inviteLink: string
  }) => Promise<void>
  /** Base URL for building invitation links. */
  baseUrl: string
  /** Invitation lifetime in ms (INVITATION_EXPIRY_SECONDS in shared/auth/auth). */
  invitationExpiresInMs: number
  /** Delete a user (compensating transaction for registration rollback). */
  deleteUser: (userId: string) => Promise<void>
  /** Logger supplied by the process composition boundary. */
  logger: LoggerPort
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
    /** The accepting cell's catalogue provider reference — never a URL. */
    providerRef: string | null
  }>
  cancelGoogleImportsForUser?: (organizationId: string, userId: string) => Promise<void>
  prepareGoogleConnectorDeparture?: (
    organizationId: string,
    userId: string,
    cause: 'member_removed' | 'account_admin_role_lost',
  ) => Promise<void>
  releaseMemberAuthorities?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
  /**
   * LIF-01-T21. Transfer-first leave needs the Portal, Property and Inbox
   * facts that name what a departing member still holds, so it is composed
   * rather than inferred. ABSENT IS FAIL-CLOSED: with no adapter the leave
   * command refuses, because a leave that cannot see the worklist would
   * silently strand every responsibility on it. AccountAdmin-initiated
   * `removeMember` is unaffected — it releases rather than transfers.
   */
  memberOffboarding?: MemberOffboardingPort
  organizationLifecycle?: IdentityOrganizationLifecycleComposition
}>

/**
 * Build the container-scoped post-acceptance capability used by the Better
 * Auth Identity adapter. Property selections from the durable invitation are
 * access grants only; Staff participation remains a separate manager command.
 * Each Property is failure-isolated so one stale selection cannot suppress a
 * valid sibling grant, while retry/concurrency converges on the active row.
 */
export function createInvitationPropertyAccessProvisioner(
  deps: Readonly<{
    db: Database
    clock: Clock
    logger: Pick<LoggerPort, 'warn'>
  }>,
): IdentityPort['runOnAcceptInvitation'] {
  return async ({ organizationId: orgId, userId, propertyIds }) => {
    for (const propertyId of propertyIds) {
      const input = { organizationId: orgId, propertyId, userId } as const
      try {
        if (await hasActiveGrant(deps.db, { ...input, at: deps.clock() })) continue
        try {
          await grantPropertyAccess(deps.db, {
            ...input,
            source: 'invitation',
            createdBy: `invitation:${userId}`,
          })
        } catch (error) {
          // A concurrent/retried acceptance may have won the unique race.
          // Suppress only after a fresh authority read proves convergence.
          const active = await hasActiveGrant(deps.db, {
            ...input,
            at: deps.clock(),
          })
          if (!active) throw error
        }
      } catch (error) {
        deps.logger.warn({ err: error }, 'Failed to provision invited property access')
      }
    }
  }
}

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

type ContributorReadiness = Readonly<{
  contributorsConfigured: boolean
  missingContexts: readonly OrganizationLifecycleContext[]
}>

function contributorReadiness(
  contributors: readonly Readonly<{ context: OrganizationLifecycleContext }>[] = [],
  surface = 'Organization lifecycle',
): ContributorReadiness {
  const contexts = contributors.map(({ context }) => context)
  if (new Set(contexts).size !== contexts.length) {
    throw new Error(`${surface} composition has duplicate context owners`)
  }
  const missingContexts = ORGANIZATION_LIFECYCLE_CONTEXTS.filter(
    (context) => !contexts.includes(context),
  )
  return Object.freeze({
    contributorsConfigured:
      missingContexts.length === 0 &&
      contexts.length === ORGANIZATION_LIFECYCLE_CONTEXTS.length,
    missingContexts: Object.freeze(missingContexts),
  })
}

/**
 * Which lifecycle and export capabilities the supplied composition can actually
 * execute. A partially bound set stays non-executable rather than exposing a
 * half-wired maintenance surface.
 */
function deriveLifecycleCompositionReadiness(deps: IdentityContextDeps) {
  const lifecycleContributorReadiness = contributorReadiness(
    deps.organizationLifecycle?.lifecycleContributors,
  )
  const suppliedExportContributors = deps.organizationLifecycle?.exportContributors ?? []
  if (suppliedExportContributors.some(({ context }) => context === 'identity')) {
    throw new Error(
      'Organization Export composition must not override the Identity-owned contributor',
    )
  }
  const exportContributors = Object.freeze([
    createIdentityOrganizationExportContributor(deps.db),
    ...suppliedExportContributors,
  ])
  const exportContributorReadiness = contributorReadiness(
    exportContributors,
    'Organization Export',
  )
  const supportAuthorizationConfigured =
    deps.organizationLifecycle?.supportAuthorization !== undefined
  const exportStorageConfigured =
    deps.organizationLifecycle?.organizationExport !== undefined
  // A reclaimed lease must recover an object written before an ambiguous
  // post-upload crash without rebuilding a historical snapshot. Migration 0170
  // added the durable pre-egress evidence that makes that possible: the row
  // records its coverage/manifest/archive digests and object key BEFORE the
  // upload, so a reclaimed lease can ask storage whether those exact bytes
  // landed and then complete with the original digests or fail closed.
  //
  // The fence is therefore derived from the supplied storage rather than
  // hard-coded: a storage adapter that cannot answer verifyStored still cannot
  // recover, and production composition still refuses.
  const exportGenerationRecoveryConfigured =
    typeof deps.organizationLifecycle?.organizationExport?.storage.verifyStored ===
    'function'
  return {
    lifecycleContributorReadiness,
    exportContributors,
    exportContributorReadiness,
    supportAuthorizationConfigured,
    lifecycleCompositionConfigured:
      lifecycleContributorReadiness.contributorsConfigured &&
      supportAuthorizationConfigured,
    exportStorageConfigured,
    exportGenerationRecoveryConfigured,
    exportCompositionConfigured:
      exportContributorReadiness.contributorsConfigured &&
      exportStorageConfigured &&
      exportGenerationRecoveryConfigured,
  }
}

/**
 * Compose the organization lifecycle and export control plane from the bound
 * readiness: only fully bound services become executable.
 */
function buildOrganizationLifecycleComposition(
  deps: IdentityContextDeps,
  bindings: Readonly<{
    policyStore: ReturnType<typeof initPersistedCapabilityPolicyStore>
    managerMembershipRepo: ReturnType<typeof createManagerMembershipRepository>
  }>,
) {
  const { policyStore, managerMembershipRepo } = bindings
  const organizationLifecycleStore = createOrganizationLifecycleCommandStore(
    deps.db,
    deps.events,
  )
  const organizationLifecycle = createOrganizationLifecycle({
    store: organizationLifecycleStore,
    clock: deps.clock,
    // Thunk: `reactivate` is constructed below, and a closure must not be
    // armable in a deployment that cannot undo it.
    reactivationConfigured: () => reactivate !== null,
    refreshPolicy: async () => {
      const result = await policyStore.refreshRequired()
      if ('unavailable' in result) {
        // The command is already durable and retry-safe. A caller must retry
        // the same operation id; do not claim this process observes the fence.
        throw new Error('Organization closure committed; policy refresh unavailable')
      }
    },
  })
  const {
    lifecycleContributorReadiness,
    exportContributors,
    exportContributorReadiness,
    supportAuthorizationConfigured,
    lifecycleCompositionConfigured,
    exportStorageConfigured,
    exportGenerationRecoveryConfigured,
    exportCompositionConfigured,
  } = deriveLifecycleCompositionReadiness(deps)
  const organizationLifecycleCoordinator =
    lifecycleCompositionConfigured &&
    deps.organizationLifecycle?.supportAuthorization &&
    deps.organizationLifecycle.lifecycleContributors
      ? createOrganizationLifecycleCoordinator({
          store: organizationLifecycleStore,
          contributors: deps.organizationLifecycle.lifecycleContributors,
          supportAuthorization: deps.organizationLifecycle.supportAuthorization,
          clock: deps.clock,
        })
      : null
  const organizationExport =
    exportCompositionConfigured && deps.organizationLifecycle?.organizationExport
      ? createOrganizationExportService({
          repository: createOrganizationExportRepository(deps.db),
          contributors: exportContributors,
          archiveWriter: deps.organizationLifecycle.organizationExport.archiveWriter,
          storage: deps.organizationLifecycle.organizationExport.storage,
          authority: {
            isCurrentAccountAdmin: ({ organizationId: orgId, actorUserId }) =>
              managerMembershipRepo.isCurrentAccountAdmin({
                organizationId: orgId,
                userId: actorUserId,
              }),
          },
          deriveRetrievalSecret:
            deps.organizationLifecycle.organizationExport.deriveRetrievalSecret,
          clock: deps.clock,
        })
      : null
  // LIF-01-T18. Reactivation is an AccountAdmin command, but its readiness
  // spans four other contexts, so it exists only when every probe is bound.
  // An unbound reactivation is not a degraded reactivation — it would be a
  // reactivation that cannot see what it is resuming.
  const reactivationProbes = deps.organizationLifecycle?.reactivationProbes
  const reactivate = reactivationProbes
    ? reactivateOrganization({
        store: organizationLifecycleStore,
        readiness: createDefaultOrganizationReactivationReadiness(reactivationProbes),
        clock: deps.clock,
        refreshPolicy: async () => {
          const result = await policyStore.refreshRequired()
          if ('unavailable' in result) {
            // The suspension is already lifted durably. Do not claim this
            // process observes it; the caller must retry the same operation id.
            throw new Error('Organization reactivated; policy refresh unavailable')
          }
        },
      })
    : null

  const organizationLifecycleRuntime = Object.freeze({
    control: Object.freeze({
      ...organizationLifecycle,
      reactivation: Object.freeze({
        configured: reactivate !== null,
        reactivate: reactivate
          ? (input: ReactivateOrganizationInput) => reactivate(input)
          : undefined,
      }),
    }),
    operator: Object.freeze({
      readStatus: (orgId: string) => organizationLifecycleStore.getAuthority(orgId),
    }),
    maintenance: Object.freeze({
      readiness: Object.freeze({
        configured: lifecycleCompositionConfigured,
        ...lifecycleContributorReadiness,
        supportAuthorizationConfigured,
      }),
      runScheduledPass: organizationLifecycleCoordinator
        ? (input?: Readonly<{ limit?: number }>) =>
            organizationLifecycleCoordinator.runScheduledPass(input)
        : undefined,
    }),
    support: organizationLifecycleCoordinator
      ? Object.freeze({
          waiveRecoveryWindow: (input: WaiveOrganizationRecoveryInput) =>
            organizationLifecycleCoordinator.waiveRecoveryWindow(input),
          cancelPendingPurge: (input: CancelPendingOrganizationPurgeInput) =>
            organizationLifecycleCoordinator.cancelPendingPurge(input),
          beginIrreversiblePurge: (input: BeginIrreversibleOrganizationPurgeInput) =>
            organizationLifecycleCoordinator.beginIrreversiblePurge(input),
        })
      : undefined,
    organizationExport: Object.freeze({
      readiness: Object.freeze({
        configured: exportCompositionConfigured,
        ...exportContributorReadiness,
        storageConfigured: exportStorageConfigured,
        generationRecoveryConfigured: exportGenerationRecoveryConfigured,
      }),
      service: organizationExport ?? undefined,
    }),
  })
  return { organizationLifecycle, runtime: organizationLifecycleRuntime }
}

export const buildIdentityContext = (deps: IdentityContextDeps) => {
  // ARC-03-T13: Identity derives its session-shaped callbacks from the injected
  // port. Setting the active organization is non-fatal by contract — during
  // registration the session cookie does not exist yet, and the user picks it
  // up on first login — so the failure is observed, not propagated.
  const setActiveOrganization = async (orgId: string): Promise<void> => {
    try {
      await deps.authSession.setActiveOrganization(orgId)
    } catch (error) {
      deps.logger.warn({ err: error }, 'Failed to set active organization during setup')
    }
  }
  const resolveOrganizationName = async (_ctx: AuthContext): Promise<string> =>
    (await deps.authSession.currentOrganizationName()) ?? 'Unknown Organization'

  const managerMembershipRepo = createManagerMembershipRepository(
    deps.db,
    async ({ organizationId: orgId, userId: memberUserId, memberRole }) => {
      const { context } = await resolveMemberAuthContextWithDatabase(deps.db, {
        organizationId: orgId,
        userId: memberUserId,
        memberRole,
      })
      if (!canForContext(context, 'property.read')) return null
      const scope = scopeForPermission(context, 'property.read')
      return scope === 'none' ? null : scope
    },
  )
  // BQC-3.5: every identity state mutation + fact commits atomically here.
  const commandStore = createAtomicIdentityCommandStore(deps.db, deps.events, deps.idGen)
  /**
   * LIF-01-T21 fail-closed default. Refusing to answer is the only safe
   * answer: reporting an empty worklist would let a member walk out leaving
   * Portals and Properties with no Responsible Manager.
   */
  const memberOffboarding: MemberOffboardingPort = deps.memberOffboarding ?? {
    listOutstanding: async () => {
      throw identityError(
        'forbidden',
        'Transfer-first leave is unavailable until responsibility facts are composed',
      )
    },
    isEligibleRecipient: async () => false,
    transfer: async () => {
      throw identityError(
        'forbidden',
        'Transfer-first leave is unavailable until responsibility facts are composed',
      )
    },
  }
  const invitedRegistrationStore = createInvitedRegistrationStore(deps.db)

  // BQC-2.2: install the composite capability policy store — env global
  // posture (kill switch / e2e overrides unchanged) + persisted tenant state
  // (allowlist/suspension from the 0014 policy tables). The env seed unions
  // in, so behavior is identical until DB policy rows exist; revocation and
  // suspension take effect within POLICY_REFRESH_INTERVAL_MS.
  const policyStore = initPersistedCapabilityPolicyStore({
    db: deps.db,
    env: deps.policy.env,
    clock: deps.clock,
    logger: deps.logger,
    admitPropertyExecution: deps.policy.admitPropertyExecution,
  })
  const { organizationLifecycle, runtime: organizationLifecycleRuntime } =
    buildOrganizationLifecycleComposition(deps, {
      policyStore,
      managerMembershipRepo,
    })
  const merchantAiAuthorization = createMerchantAiAuthorization({
    store: createMerchantAiAuthorizationStore(
      deps.db,
      deps.events,
      deps.idGen,
      deps.logger,
    ),
    authorizeManagement: async (input) => {
      const role = await getMemberRole(deps.db, input.organizationId, input.actorUserId)
      if (!role) return false
      try {
        const decision = await decideMemberPropertyAuthority(deps.db, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          userId: input.actorUserId,
          memberRole: role,
          permission: 'ai.manage',
          at: input.now,
        })
        return decision.allowed
      } catch {
        return false
      }
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
      (await deps.authSession.verifyPassword({
        headers: input.requestHeaders,
        password: input.proof,
      })),
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
  const policyAdminCommandStore = createPostgresPolicyAdminCommandStore(deps.db)
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
    commandStore: policyAdminCommandStore,
    loadOrgPolicyState: (orgId) => loadOrgPolicyState(deps.db, orgId),
    reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
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

  const hasActivePropertyGrant = (
    tx: Database,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => hasActiveGrant(tx, input)

  /**
   * Transaction-bound Identity authority for cross-context protected writes.
   * The caller supplies its command transaction so membership, effective
   * reply permission, Property scope, and the write share one revocation
   * boundary instead of relying on enqueue-time attribution.
   */
  const decidePublicationActorAuthority = (
    tx: MemberPropertyAuthorityDatabase,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) =>
    decideCurrentMemberPropertyAuthority(tx, {
      ...input,
      permission: 'reply.manage',
    })

  /**
   * Transaction-bound, owning-context authority for commands that require
   * several manager permissions but only one membership/grant snapshot.
   */
  const decideManagerPropertyAuthority = (
    tx: MemberPropertyAuthorityDatabase,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      permissions: readonly Permission[]
      at: Date
    }>,
  ) => decideCurrentManagerPropertyAuthority(tx, input)

  /**
   * Transaction-bound authority for every principal/Property tuple in one
   * command. Identity owns the globally ordered membership/grant locks and the
   * command-wide permission-generation cutover.
   */
  const decideManagerPropertyAuthorities = (
    tx: MemberPropertyAuthorityDatabase,
    input: Readonly<{
      organizationId: string
      requirements: readonly ManagerPropertyAuthorityRequirement[]
      at: Date
    }>,
  ) => decideCurrentManagerPropertyAuthorities(tx, input)

  const useCases = {
    inviteMember: inviteMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      idGen: () => invitationId(deps.idGen()),
      invitationExpiresInMs: deps.invitationExpiresInMs,
      sendEmail: deps.sendEmail,
      getOrganizationName: resolveOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    updateMemberRole: updateMemberRole({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
      prepareGoogleConnectorDeparture: deps.prepareGoogleConnectorDeparture,
    }),
    removeMember: removeMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      cancelGoogleImportsForUser: deps.cancelGoogleImportsForUser,
      prepareGoogleConnectorDeparture: deps.prepareGoogleConnectorDeparture,
      releaseMemberAuthorities: deps.releaseMemberAuthorities,
    }),
    leaveOrganization: leaveOrganization({
      identity: deps.identityPort,
      commandStore,
      offboarding: memberOffboarding,
      clock: deps.clock,
      cancelGoogleImportsForUser: deps.cancelGoogleImportsForUser,
      prepareGoogleConnectorDeparture: deps.prepareGoogleConnectorDeparture,
    }),
    listInvitations: listInvitations({ identity: deps.identityPort }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: deps.sendEmail,
      getOrganizationName: resolveOrganizationName,
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
      setActiveOrg: setActiveOrganization,
      clock: deps.clock,
      idGen: () => organizationId(deps.idGen()),
      commandStore,
      deleteUser: deps.deleteUser,
      logger: deps.logger,
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
    registerInvitedUser: registerInvitedUser({
      commandStore,
      registrationStore: invitedRegistrationStore,
      signUp: deps.identityPort.signUp,
      idGen: deps.idGen,
      runOnAccepted: deps.identityPort.runOnAcceptInvitation,
      clock: deps.clock,
      logger: deps.logger,
    }),
    recoverInvitedRegistrations: recoverInvitedRegistrations({
      commandStore,
      registrationStore: invitedRegistrationStore,
      runOnAccepted: deps.identityPort.runOnAcceptInvitation,
      idGen: deps.idGen,
      clock: deps.clock,
      logger: deps.logger,
    }),
    updateOrganization: updateOrganization({
      updateOrg: deps.authSession.updateOrganization,
    }),
    createCustomRole: createCustomRole({ identity: deps.identityPort }),
    updateCustomRole: updateCustomRole({ identity: deps.identityPort }),
    deleteCustomRole: deleteCustomRole({ identity: deps.identityPort }),
    merchantAiAuthorization,
    organizationLifecycle,
  } as const

  const merchantAiRequestApi: IdentityRequestApi['merchantAiAuthorization'] =
    Object.freeze({
      get: useCases.merchantAiAuthorization.get,
      enable: useCases.merchantAiAuthorization.enable,
      change: useCases.merchantAiAuthorization.change,
      revoke: useCases.merchantAiAuthorization.revoke,
    })
  const requestApi: IdentityRequestApi = Object.freeze({
    inviteMember: useCases.inviteMember,
    updateMemberRole: useCases.updateMemberRole,
    removeMember: useCases.removeMember,
    leaveOrganization: useCases.leaveOrganization,
    listInvitations: useCases.listInvitations,
    resendInvitation: useCases.resendInvitation,
    acceptInvitation: useCases.acceptInvitation,
    cancelInvitation: useCases.cancelInvitation,
    registerInvitedUser: useCases.registerInvitedUser,
    registerUserAndOrg: useCases.registerUserAndOrg,
    updateOrganization: useCases.updateOrganization,
    createCustomRole: useCases.createCustomRole,
    updateCustomRole: useCases.updateCustomRole,
    deleteCustomRole: useCases.deleteCustomRole,
    merchantAiAuthorization: merchantAiRequestApi,
  })
  const managerFacts: IdentityManagerFactsPublicApi = Object.freeze({
    listActiveManagers: managerMembershipRepo.listActiveManagers,
  })
  const accountAdminAuthority: IdentityAccountAdminAuthorityPublicApi = Object.freeze({
    isCurrentAccountAdmin: managerMembershipRepo.isCurrentAccountAdmin,
  })
  const offboardingFacts = Object.freeze({
    listOutstanding: memberOffboarding.listOutstanding,
  })
  const publicApi: IdentityPublicApi = Object.freeze({
    managerFacts,
    accountAdminAuthority,
    offboardingFacts,
    requests: requestApi,
  })

  return {
    publicApi,
    worker: Object.freeze({
      recoverInvitedRegistrations: useCases.recoverInvitedRegistrations,
    }),
    // ARC-03-T11/T12: named capability groups replace the former `internal`
    // grab-bag. The composition root was its only consumer, so the root now
    // names WHAT it takes from Identity instead of reaching through a
    // context-private hatch.
    /** Capability-policy control plane owned by Identity. */
    policy: Object.freeze({
      // BQC-2.7: least-privilege policy administration operations.
      admin: policyAdmin,
      // BQC-2.2: version-gated strong read of persisted policy state
      // (readiness contribution — the worker awaits it before starting).
      refresh: policyStore.refresh,
      refreshRequired: policyStore.refreshRequired,
      // BQC-7.3 (versions.policy_store): cheap in-memory read of the current
      // persisted policy_version for the OperationsSnapshot (null when only
      // the env seed is present — no DB round-trip).
      currentVersion: policyStore.currentVersion,
      // ARC-03-T6: the poller this build started is released through the
      // container's shutdown seam. Identity must surface the stop function —
      // dropping it is what leaked a live interval per container built.
      stopPolling: policyStore.stopPolling,
      // ARC-03-T8: container-owned policy objects. Building identity no longer
      // installs them process-wide; an entry point binds exactly one set.
      capabilityPolicyStore: policyStore.capabilityPolicyStore,
      executionPolicy: policyStore.executionPolicy,
      delayedExecutionPolicy: policyStore.delayedExecutionPolicy,
    }),
    /** Authority decisions and grant facts other contexts must ask Identity for. */
    authority: Object.freeze({
      // BQC-4.5: operator audit sink for the property region-move workflow.
      writeOperatorAudit,
      // Identity owns the grant table; callers supply their authorization
      // transaction so the grant read participates in the same commit check.
      hasActivePropertyGrant,
      decideManagerPropertyAuthority,
      decideManagerPropertyAuthorities,
      decidePublicationActorAuthority,
      // Property-scoped recipient resolution for other contexts (notification
      // fan-out). Identity owns the grant table, so the read lives here.
      propertyAccessHolders: createPropertyGrantHolderLookup(deps.db, deps.clock),
      revokeAllPropertyAccessForUser: (organizationId: string, userId: string) =>
        revokeAllPropertyAccessForUser(deps.db, {
          organizationId,
          userId,
          reason: 'member_offboarded',
        }),
    }),
    // Named lifecycle/export control plane. It exposes AccountAdmin
    // commands, content-free operator diagnostics, and only fully bound
    // maintenance services; partial contributor sets remain non-executable.
    lifecycle: organizationLifecycleRuntime,
  } as const
}
