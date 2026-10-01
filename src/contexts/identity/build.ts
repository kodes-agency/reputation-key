// Identity context — build function.
// Wires identity port, the atomic command store (BQC-3.5), and use cases.
// Per ADR-0001: the composition root calls this and merges useCases into the container.
//
// Readiness/runtime contributions exposed to the composition root:
//   - internal.refreshPolicyStore — BQC-2.2 version-gated strong read of
//     persisted policy state (workers await it before starting; side-effect
//     paths use it for fresh reads, BQC-2.5).
//   - internal.policyAdmin — BQC-2.7 least-privilege policy administration ops.
//   - internal.organizationLifecycleRuntime — named lifecycle/export control,
//     content-free diagnostics, and contributor-gated maintenance services.

import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { IdentityPort } from './application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { createCustomRole } from './application/use-cases/create-custom-role'
import { updateCustomRole } from './application/use-cases/update-custom-role'
import { deleteCustomRole } from './application/use-cases/delete-custom-role'
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import {
  leaveOrganization,
  type MemberOffboarding,
} from './application/use-cases/leave-organization'
import { identityError } from './domain/errors'
import { updateOrganization } from './application/use-cases/update-organization'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { buildInvitationUseCases, type InvitationUseCaseDeps } from './build-invitations'
import { buildCapabilityPolicyHandle } from './infrastructure/policy-store-init'
import { createPolicyAdminOps } from './application/use-cases/policy-admin'
import { createPolicyDiagnostic } from '#/shared/auth/policy-diagnostic'
import { createCapabilityRefusalExplainer } from '#/shared/governance/capability-refusal'
import { createCapabilityRefusalReaders } from './infrastructure/repositories/capability-refusal.repository'
import {
  checkScopedCapability,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import { createMerchantAiAuthorization } from './application/use-cases/merchant-ai-authorization'
import { createMerchantAiDecisionDeferral } from './application/use-cases/merchant-ai-decision-deferral'
import { listMerchantAiOverview } from './application/use-cases/merchant-ai-overview'
import { createMerchantAiAuthorizationStore } from './infrastructure/repositories/merchant-ai-authorization.repository'
import { createMerchantAiDecisionDeferralStore } from './infrastructure/repositories/merchant-ai-decision.repository'
import { createMerchantAiOverviewReader } from './infrastructure/repositories/merchant-ai-overview.repository'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  MERCHANT_AI_SOURCE_POLICY_ID,
} from './application/dto/merchant-ai-notice.dto'
import { getMemberRole } from './infrastructure/repositories/manager-membership.repository'
import {
  revokeAllPropertyAccessForUser,
  hasActiveGrant,
} from './infrastructure/repositories/property-access-grant.repository'
import {
  createGrantAccessLookup,
  createPropertyGrantHolderLookup,
} from './infrastructure/adapters/grant-access-lookup.adapter'
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
  createMemberPropertyAuthorityLookup,
  decideCurrentMemberPropertyAuthority,
  decideMemberPropertyAuthority,
  resolveMemberPermissionPropertyScope,
  type ManagerPropertyAuthorityRequirement,
  type MemberPropertyAuthorityDatabase,
} from './infrastructure/repositories/member-property-authority'
import { trace } from '#/shared/observability/trace'
import { createStaffParticipationRepository } from './infrastructure/repositories/staff-participation.repository'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from './application/use-cases/staff-participations'
import { createPrimaryStaffAttributionResolver } from './infrastructure/primary-staff-attribution'
import { submitBetaFeedback } from './application/use-cases/submit-beta-feedback'
import { listMyBetaFeedback } from './application/use-cases/list-my-beta-feedback'
import { BetaFeedbackTriageRepository } from './infrastructure/beta-feedback-triage.repository'
import { deliverBetaFeedback } from './infrastructure/adapters/beta-feedback-sentry-delivery.adapter'

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

type AuthSession = Readonly<{
  setActiveOrganization: (organizationId: string) => Promise<void>
  updateOrganization: (data: Record<string, unknown>) => Promise<void>
  currentOrganizationName: () => Promise<string | null>
  verifyPassword: (
    input: Readonly<{ headers: Headers; password: string }>,
  ) => Promise<boolean>
}>

type IdentityContextDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  clock: Clock
  idGen: () => string
  /**
   * ARC-03-T13: the authenticated session dependency. The four operations the
   * root used to perform inline against the better-auth process singleton
   * (set active org, update org, read org name, verify password) remain one
   * Identity-owned structural contract.
   */
  authSession: AuthSession
  /** Send an invitation email. */
  sendEmail: InvitationUseCaseDeps['sendEmail']
  /** Base URL for building invitation links. */
  baseUrl: string
  /** Invitation lifetime in ms (INVITATION_EXPIRY_SECONDS in shared/auth/auth). */
  invitationExpiresInMs: number
  /** Property display names, from the Property public API (composition). */
  propertyNames: InvitationUseCaseDeps['propertyNames']
  /** Logger supplied by the process composition boundary. */
  logger: LoggerPort
  /** Keys the content-free beta-feedback telemetry pseudonyms. */
  betaFeedbackHmacSecret: string
  /**
   * BQC-2.2/2.7 capability-policy wiring. Identity owns the persisted policy
   * store (readiness), the least-privilege admin ops, and the operator audit
   * sink; the composition root supplies the environment policy.
   */
  policy: Readonly<{
    env: CapabilityPolicyEnv
    /** Suspension recovery bypasses the suspended property gate, then proves tenancy here. */
    propertyBelongsToOrganization: (
      organizationId: string,
      propertyId: string,
    ) => Promise<boolean>
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
   * Whether it was supplied is published as
   * `offboardingFacts.selfServiceLeaveAvailable`.
   */
  memberOffboarding?: MemberOffboarding
  organizationLifecycle?: IdentityOrganizationLifecycleComposition
}>

export { createInvitationPropertyAccessProvisioner } from './infrastructure/invitation-property-access-provisioner'

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
    policyStore: ReturnType<typeof buildCapabilityPolicyHandle>
    managerMembershipRepo: ReturnType<typeof createManagerMembershipRepository>
  }>,
) {
  const { policyStore, managerMembershipRepo } = bindings
  const organizationLifecycleStore = createOrganizationLifecycleCommandStore(deps.db)
  const organizationLifecycle = createOrganizationLifecycle({
    store: organizationLifecycleStore,
    clock: deps.clock,
    // Thunk: `reactivate` is constructed below, and a closure must not be
    // armable in a deployment that cannot undo it.
    reactivationConfigured: () => reactivate !== null,
    refreshPolicy: policyStore.refreshRequired,
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
  // spans three other contexts, so it exists only when every probe is bound.
  // An unbound reactivation is not a degraded reactivation — it would be a
  // reactivation that cannot see what it is resuming.
  const reactivationProbes = deps.organizationLifecycle?.reactivationProbes
  const reactivate = reactivationProbes
    ? reactivateOrganization({
        store: organizationLifecycleStore,
        readiness: createDefaultOrganizationReactivationReadiness(reactivationProbes),
        clock: deps.clock,
        refreshPolicy: policyStore.refreshRequired,
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

function buildPeopleSurface(deps: Pick<IdentityContextDeps, 'db' | 'clock' | 'idGen'>) {
  const accessiblePropertyLookup = createGrantAccessLookup(deps.db, deps.clock)
  const participationRepo = createStaffParticipationRepository(deps.db)
  const resolvePrimaryStaffAttribution = createPrimaryStaffAttributionResolver(deps.db)

  const responsibilityLookup = {
    listAssignedPortalIds: async (
      organizationId: OrganizationId,
      userId: UserId,
      propertyId: PropertyId,
    ) => {
      const participation = await participationRepo.findActiveByUser(
        organizationId,
        propertyId,
        userId,
      )
      if (!participation) return []
      const responsibilities = await participationRepo.listActiveResponsibilities(
        organizationId,
        participation.id,
      )
      return responsibilities.map((responsibility) => portalId(responsibility.portalId))
    },
  } as const

  const facts = Object.freeze({
    getAccessiblePropertyIds: async (
      organizationId: OrganizationId,
      userId: UserId,
      orgWide: boolean,
    ) => {
      if (orgWide) return null
      return trace('identity.people.getAccessiblePropertyIds', () =>
        accessiblePropertyLookup(organizationId, userId),
      )
    },
    getAssignedPortals: (
      input: Readonly<{ userId: UserId; propertyId: PropertyId }>,
      ctx: AuthContext,
    ) =>
      responsibilityLookup.listAssignedPortalIds(
        ctx.organizationId,
        input.userId,
        input.propertyId,
      ),
    resolvePrimaryStaffAttribution,
    findParticipationById: (organizationId: OrganizationId, participationId: string) =>
      participationRepo.findById(organizationId, participationId),
    listActiveParticipations: (organizationId: OrganizationId, propertyId: PropertyId) =>
      participationRepo.list(organizationId, { propertyId, activeOnly: true }),
  })

  const management = Object.freeze({
    createStaffParticipation: createStaffParticipation({
      repo: participationRepo,
      accessibleProperties: accessiblePropertyLookup,
      clock: deps.clock,
      idGen: deps.idGen,
    }),
    listStaffParticipations: listStaffParticipations({
      repo: participationRepo,
      accessibleProperties: accessiblePropertyLookup,
      clock: deps.clock,
      idGen: deps.idGen,
    }),
    archiveStaffParticipation: archiveStaffParticipation({
      repo: participationRepo,
      accessibleProperties: accessiblePropertyLookup,
      clock: deps.clock,
      idGen: deps.idGen,
    }),
    updatePortalResponsibilities: updatePortalResponsibilities({
      repo: participationRepo,
      accessibleProperties: accessiblePropertyLookup,
      clock: deps.clock,
      idGen: deps.idGen,
    }),
  })

  return {
    publicApi: Object.freeze({ ...facts, management }),
  } as const
}

/**
 * A reporter's own beta-feedback requests. Requests reach the triage
 * repository only through these; its operator workflow stays with scripts/ops.
 */
function buildBetaFeedbackRequests(deps: IdentityContextDeps) {
  const store = BetaFeedbackTriageRepository.create(deps.db)
  const hmacSecret = deps.betaFeedbackHmacSecret
  return Object.freeze({
    submit: submitBetaFeedback({
      store,
      deliver: deliverBetaFeedback,
      clock: deps.clock,
      idGen: deps.idGen,
      hmacSecret,
    }),
    listMine: listMyBetaFeedback({ store, hmacSecret }),
  })
}

export const buildIdentityContext = (deps: IdentityContextDeps) => {
  // The merged People surface remains first in the load-bearing construction
  // order and shares Identity's grant authority.
  const people = buildPeopleSurface(deps)
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
  const commandStore = createAtomicIdentityCommandStore(deps.db, deps.idGen)
  /**
   * LIF-01-T21 fail-closed default. Refusing to answer is the only safe
   * answer: reporting an empty worklist would let a member walk out leaving
   * Portals and Properties with no Responsible Manager.
   */
  const memberOffboarding: MemberOffboarding = deps.memberOffboarding ?? {
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
  const invitationUseCases = buildInvitationUseCases({
    ...deps,
    commandStore,
    resolveOrganizationName,
  })

  // Capability fate and environment controls are process-static. Tenant
  // grants, consent, and the execution kill switch retain their live reads.
  const policyStore = buildCapabilityPolicyHandle({
    db: deps.db,
    env: deps.policy.env,
    clock: deps.clock,
    logger: deps.logger,
  })
  const { organizationLifecycle, runtime: organizationLifecycleRuntime } =
    buildOrganizationLifecycleComposition(deps, {
      policyStore,
      managerMembershipRepo,
    })
  const merchantAiDecisionDeferrals = createMerchantAiDecisionDeferralStore(deps.db)
  const authorizeMerchantAiManagement = async (
    input: Readonly<{
      organizationId: string
      propertyId: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<boolean> => {
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
  }
  const merchantAiDecisionDeferral = createMerchantAiDecisionDeferral({
    store: merchantAiDecisionDeferrals,
    authorizeManagement: authorizeMerchantAiManagement,
    clock: deps.clock,
  })
  const listMerchantAiOverviewRead = listMerchantAiOverview({
    reader: createMerchantAiOverviewReader(deps.db),
    // The same ai.manage authority as each Property command, resolved once.
    resolveManagementScope: (input) =>
      resolveMemberPermissionPropertyScope(deps.db, {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        permission: 'ai.manage',
        at: input.now,
      }),
    clock: deps.clock,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  })
  const merchantAiAuthorization = createMerchantAiAuthorization({
    store: createMerchantAiAuthorizationStore(deps.db, deps.idGen),
    decisionDeferrals: merchantAiDecisionDeferrals,
    authorizeManagement: authorizeMerchantAiManagement,
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
    isCurrentAccountAdmin: ({ organizationId: orgId, actorUserId }) =>
      managerMembershipRepo.isCurrentAccountAdmin({
        organizationId: orgId,
        userId: actorUserId,
      }),
    verifyStepUp: async (input) =>
      input.requestHeaders !== undefined &&
      (await deps.authSession.verifyPassword({
        headers: input.requestHeaders,
        password: input.proof,
      })),
    clock: deps.clock,
    idGen: deps.idGen,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
    redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  })

  // PropertyAccessGrant administration. Capability configuration is immutable
  // for the process and has no table-backed admin mutations.
  const policyDiagnostic = createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(deps.db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(deps.db, input),
  })
  const policyAdminCommandStore = createPostgresPolicyAdminCommandStore(deps.db)
  const explainCapabilityRefusal = createCapabilityRefusalExplainer(
    createCapabilityRefusalReaders(deps.db),
  )
  const policyAdmin = Object.freeze({
    ...createPolicyAdminOps({
      explainPolicyDecision: (input) => policyDiagnostic(input),
      commandStore: policyAdminCommandStore,
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
    }),
    explainCapabilityRefusal,
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
    ...invitationUseCases,
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
    updateOrganization: updateOrganization({
      updateOrg: deps.authSession.updateOrganization,
    }),
    createCustomRole: createCustomRole({ identity: deps.identityPort }),
    updateCustomRole: updateCustomRole({ identity: deps.identityPort }),
    deleteCustomRole: deleteCustomRole({ identity: deps.identityPort }),
    merchantAiAuthorization,
    merchantAiDecisionDeferral,
    listMerchantAiOverview: listMerchantAiOverviewRead,
    organizationLifecycle,
  } as const

  const merchantAiRequestApi = Object.freeze({
    get: useCases.merchantAiAuthorization.get,
    enable: useCases.merchantAiAuthorization.enable,
    enableForProperties: useCases.merchantAiAuthorization.enableForProperties,
    change: useCases.merchantAiAuthorization.change,
    revoke: useCases.merchantAiAuthorization.revoke,
    defer: useCases.merchantAiDecisionDeferral.defer,
    listOverview: useCases.listMerchantAiOverview,
  })
  const requestApi = Object.freeze({
    inviteMember: useCases.inviteMember,
    updateMemberRole: useCases.updateMemberRole,
    removeMember: useCases.removeMember,
    leaveOrganization: useCases.leaveOrganization,
    listInvitations: useCases.listInvitations,
    resendInvitation: useCases.resendInvitation,
    acceptInvitation: useCases.acceptInvitation,
    cancelInvitation: useCases.cancelInvitation,
    getInvitationPreview: useCases.getInvitationPreview,
    registerInvitedUser: useCases.registerInvitedUser,
    updateOrganization: useCases.updateOrganization,
    createCustomRole: useCases.createCustomRole,
    updateCustomRole: useCases.updateCustomRole,
    deleteCustomRole: useCases.deleteCustomRole,
    merchantAiAuthorization: merchantAiRequestApi,
  })
  const managerFacts = Object.freeze({
    listActiveManagers: managerMembershipRepo.listActiveManagers,
    /**
     * Whether a member may act on an approval request for one Property, under
     * the same effective-permission model an interactive approval uses. Feed
     * asks this to route "Approve a reply" to people who can actually approve
     * (I5.3); it takes no locks and decides nothing, so it serves reads only.
     */
    canApproveReplies: createMemberPropertyAuthorityLookup(
      deps.db,
      'reply.manage',
      deps.clock,
    ),
  })
  const accountAdminAuthority = Object.freeze({
    isCurrentAccountAdmin: managerMembershipRepo.isCurrentAccountAdmin,
  })
  const offboardingFacts = Object.freeze({
    listOutstanding: memberOffboarding.listOutstanding,
    // Derived from the wiring, never configured separately: it can only be
    // true when a real adapter replaced the fail-closed default above.
    selfServiceLeaveAvailable: deps.memberOffboarding !== undefined,
  })
  const publicApi = Object.freeze({
    managerFacts,
    accountAdminAuthority,
    offboardingFacts,
    people: people.publicApi,
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
      // Static policy is already current; these async no-ops preserve the
      // deployment boot/readiness contract without a background poller.
      refresh: policyStore.refresh,
      refreshRequired: policyStore.refreshRequired,
      currentVersion: policyStore.currentVersion,
      // ARC-03-T8: container-owned policy objects. Building identity no longer
      // installs them process-wide; an entry point binds exactly one set.
      capabilityPolicyStore: policyStore.capabilityPolicyStore,
      executionPolicy: policyStore.executionPolicy,
      delayedExecutionPolicy: policyStore.delayedExecutionPolicy,
    }),
    /** Authority decisions and grant facts other contexts must ask Identity for. */
    authority: Object.freeze({
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
    /** Beta-feedback reporting for the signed-in reporter. Request-facing, but
     * kept off `publicApi`, which other contexts receive. */
    betaFeedback: buildBetaFeedbackRequests(deps),
  } as const
}
