import { decidePublicExecution } from '#/shared/auth/execution-policy'
import { buildStaffAccounts, type StaffAccountBindings } from './build-staff-accounts'
import { createStaffSelfReader } from './infrastructure/adapters/staff-self.reader'
// Identity context — build function.
// Wires identity port, the atomic command store (BQC-3.5), and use cases.
// Per ADR-0001: the composition root calls this and merges useCases into the container.
//
// Readiness/runtime contributions exposed to the composition root:
//   - internal.refreshPolicyStore — BQC-2.2 version-gated strong read of
//     persisted policy state (workers await it before starting; side-effect
//     paths use it for fresh reads, BQC-2.5).
//   - internal.policyAdmin — BQC-2.7 least-privilege policy administration ops.

import { createProductUpdates } from './application/use-cases/product-updates'
import { createProductUpdatesStore } from './infrastructure/repositories/product-updates.repository'
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
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { buildInvitationUseCases, type InvitationUseCaseDeps } from './build-invitations'
import { buildMerchantAiUpdates } from './build-merchant-ai-updates'
import { buildMemberAccessUseCases } from './build-member-access'
import { buildOrganizationSettingsUseCases } from './build-organization-settings'
import { buildCapabilityPolicyHandle } from './infrastructure/policy-store-init'
import { createPolicyAdminOps } from './application/use-cases/policy-admin'
import { createPolicyDiagnostic } from '#/shared/auth/policy-diagnostic'
import { createCapabilityRefusalExplainer } from '#/shared/governance/capability-refusal'
import { createOrganizationCapabilityRefusalReaders } from './infrastructure/repositories/capability-refusal.repository'
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
  isMerchantAiNoticeInForceForCapabilities,
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
import { createIdentityAssetReferences } from './infrastructure/adapters/identity-asset-references.adapter'
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
import { findBetaFeedbackReporterContact } from './infrastructure/beta-feedback-reporter'

type AuthSession = Readonly<{
  setActiveOrganization: (organizationId: string) => Promise<void>
  updateOrganization: (data: Record<string, unknown>) => Promise<void>
  currentOrganizationName: () => Promise<string | null>
  verifyPassword: (
    input: Readonly<{ headers: Headers; password: string }>,
  ) => Promise<boolean>
}>

import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
type IdentityContextDeps = Readonly<{
  staffAccounts?: StaffAccountBindings
  db: Database
  replyEffects: ReplyScopeEffects
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
  /**
   * Deletes one stored avatar or logo object. Late-bound by the composition
   * root: the object store is built with Portal, after Identity.
   */
  deleteAssetObject: (key: string) => Promise<void>
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
   * store (readiness) and the least-privilege admin ops; the composition root
   * supplies the environment policy.
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
}>

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
      if (!participation?.personalPortalId) return []
      const responsibilities = await participationRepo.listActiveResponsibilities(
        organizationId,
        participation.id,
      )
      return responsibilities
        .filter(
          (responsibility) =>
            responsibility.kind === 'primary' &&
            responsibility.portalId === participation.personalPortalId,
        )
        .map((responsibility) => portalId(responsibility.portalId))
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
      findReporterContact: (userId) => findBetaFeedbackReporterContact(deps.db, userId),
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
  const commandStore = createAtomicIdentityCommandStore(
    deps.db,
    deps.idGen,
    async (organizationId) =>
      (
        await decidePublicExecution({
          action: 'system:identity.accept_invitation',
          capability: 'staff.accounts',
          organizationId,
          now: deps.clock(),
        })
      ).allowed,
  )
  const invitationUseCases = buildInvitationUseCases({
    ...deps,
    commandStore,
    resolveOrganizationName,
  })
  const memberAccess = buildMemberAccessUseCases(deps)
  const assetReferences = createIdentityAssetReferences(deps.db)
  const organizationSettings = buildOrganizationSettingsUseCases({
    saveOrganization: deps.authSession.updateOrganization,
    assetReferences,
    deleteAssetObject: deps.deleteAssetObject,
    logger: deps.logger,
  })

  // Capability fate and environment controls are process-static. Tenant
  // grants, consent, and the execution kill switch retain their live reads.
  const policyStore = buildCapabilityPolicyHandle({
    db: deps.db,
    env: deps.policy.env,
    clock: deps.clock,
    logger: deps.logger,
  })
  const merchantAiUpdates = buildMerchantAiUpdates(deps)
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
    isNoticeInForce: isMerchantAiNoticeInForceForCapabilities,
    readLatestUpdate: merchantAiUpdates.latestForOverview,
    pauseReason: merchantAiUpdates.pauseReason,
  })
  const merchantAiAuthorization = createMerchantAiAuthorization({
    store: createMerchantAiAuthorizationStore(deps.db, deps.idGen, deps.replyEffects),
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
  // Every AccountAdmin reaches this report, so its permit tally is tenant-bound.
  const explainCapabilityRefusal = createCapabilityRefusalExplainer(
    createOrganizationCapabilityRefusalReaders(deps.db),
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

  const staffAccounts = buildStaffAccounts({ ...deps, commandStore })
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
      removeStaffForMemberDeparture: staffAccounts.removeForMemberDeparture,
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      cancelGoogleImportsForUser: deps.cancelGoogleImportsForUser,
      prepareGoogleConnectorDeparture: deps.prepareGoogleConnectorDeparture,
      releaseMemberAuthorities: deps.releaseMemberAuthorities,
    }),
    ...organizationSettings,
    merchantAiAuthorization,
    merchantAiDecisionDeferral,
    listMerchantAiOverview: listMerchantAiOverviewRead,
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
    listInvitations: useCases.listInvitations,
    resendInvitation: useCases.resendInvitation,
    acceptInvitation: useCases.acceptInvitation,
    cancelInvitation: useCases.cancelInvitation,
    getInvitationPreview: useCases.getInvitationPreview,
    registerInvitedUser: useCases.registerInvitedUser,
    updateOrganization: useCases.updateOrganization,
    merchantAiAuthorization: merchantAiRequestApi,
    merchantAiNoticeUpdates: merchantAiUpdates.updates,
    ...memberAccess,
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
  const publicApi = Object.freeze({
    managerFacts,
    accountAdminAuthority,
    people: people.publicApi,
    staffSelf: Object.freeze(createStaffSelfReader(deps.db, deps.clock)),
    staffAccounts,
    requests: requestApi,
  })

  return {
    publicApi,
    worker: Object.freeze({
      recoverInvitedRegistrations: useCases.recoverInvitedRegistrations,
      renewLapsedMerchantAiAuthorizations: merchantAiUpdates.renewal,
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
    /** Beta-feedback reporting for the signed-in reporter. Request-facing, but
     * kept off `publicApi`, which other contexts receive. */
    betaFeedback: buildBetaFeedbackRequests(deps),
    /** What still points at an uploaded avatar or logo. Request-facing, so kept off `publicApi`. */
    assetReferences,
    productUpdates: createProductUpdates({
      store: createProductUpdatesStore(deps.db),
      clock: deps.clock,
      hasCapability: ({ actor, propertyId }, capability) =>
        checkScopedCapability(
          { organizationId: actor.organizationId, propertyId },
          capability,
        ).allowed,
    }),
  } as const
}
