// Identity context — build function.
// Wires the identity port, the atomic command store and every Identity feature
// once. Per ADR-0001 the composition root calls this and merges the result into
// the container. `buildPlatformConsole` is the one separate seam: the operator
// console (ADR 0065) never reaches `publicApi`.
//
// Runtime contributions exposed to the composition root:
//   - policy.refreshRequired — version-gated strong read of persisted policy
//     state (workers await it before starting; side-effect paths use it for
//     fresh reads).
//   - policy.admin — least-privilege policy administration ops.

import type { Database } from '#/shared/db'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  invitationId,
  organizationId,
  userId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { createCapabilityRefusalExplainer } from '#/shared/governance/capability-refusal'
import {
  checkScopedCapability,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import { createPolicyDiagnostic } from '#/shared/auth/policy-diagnostic'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { trace } from '#/shared/observability/trace'
import type { IdentityPort } from './application/ports/identity.port'
import type { IdentityCommandStore } from './application/ports/identity-command-store.port'
import type { InvitationEmailSender } from './application/ports/invitation-email.port'
import type { PropertyNameLookup } from './members/invitation-read-model.port.server'
import { retireReplacedIdentityAsset } from './application/retire-replaced-identity-asset'
import { staffFailureDiagnostic } from './staff/staff-failure-diagnostic.server'
import {
  MERCHANT_AI_NOTICE,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  MERCHANT_AI_REDACTION_PROFILE_FAMILY,
  MERCHANT_AI_SOURCE_POLICY_ID,
  isMerchantAiNoticeInForceForCapabilities,
} from './application/dto/merchant-ai-notice.dto'
import { acceptInvitation } from './members/accept-invitation.server'
import { addStaffMember } from './staff/add-staff-member.server'
import { cancelInvitation } from './members/cancel-invitation.server'
import {
  cancelOrganizationAdminInvitation,
  type CancelOrganizationAdminInvitation,
} from './application/use-cases/cancel-organization-admin-invitation'
import { changeStaffInvitationEmail } from './staff/change-staff-email.server'
import { getInvitationPreview } from './members/get-invitation-preview.server'
import { inviteMember } from './members/invite-member.server'
import {
  inviteOrganizationAdmin,
  type InviteOrganizationAdmin,
} from './application/use-cases/invite-organization-admin'
import { listInvitations } from './members/list-invitations.server'
import { listMyBetaFeedback } from './feedback/list-my-beta-feedback.server'
import {
  listPlatformOrganizations,
  type ListPlatformOrganizations,
} from './operator/list-platform-organizations.server'
import {
  checkStaffBatch,
  checkStaffSource,
  listStaffMembers,
  removeStaffForMemberDeparture,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  setColleagueListEnabled,
  type ManageStaffDeps,
} from './staff/manage-staff-accounts.server'
import {
  listMemberPropertyAccess,
  setMemberPropertyAccess,
} from './members/member-property-access.server'
import { createMerchantAiAuthorization } from './consent/merchant-ai-authorization.server'
import { createMerchantAiDecisionDeferral } from './consent/merchant-ai-decision-deferral.server'
import { createMerchantAiNoticeUpdates } from './consent/merchant-ai-notice-updates.server'
import { listMerchantAiOverview } from './consent/merchant-ai-overview.server'
import { createPolicyAdminOps } from './application/use-cases/policy-admin'
import { createProductUpdates } from './updates/product-updates.server'
import {
  provisionOrganization,
  type ProvisionOrganization,
} from './application/use-cases/provision-organization'
import { recoverInvitedRegistrations } from './members/recover-invited-registrations.server'
import { registerInvitedUser } from './members/register-invited-user.server'
import { removeMember } from './members/remove-member.server'
import { roleChangeCleanup } from './members/member-role-cleanup.server'
import type { ConsumerRegistry } from '#/shared/outbox'
import { registerMemberRoleConsumers } from './infrastructure/member-role-outbox-consumers'
import { renewLapsedMerchantAiAuthorizations } from './consent/renew-lapsed-merchant-ai-authorizations.server'
import { resendInvitation } from './members/resend-invitation.server'
import {
  resendOrganizationAdminInvitation,
  type ResendOrganizationAdminInvitation,
} from './application/use-cases/resend-organization-admin-invitation'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from './application/use-cases/staff-participations'
import { submitBetaFeedback } from './feedback/submit-beta-feedback.server'
import { updateMemberRole } from './members/update-member-role.server'
import { updateOrganization } from './application/use-cases/update-organization'
import { identityMemberRemoved } from './domain/events'
import { createStaffManagementStore } from './staff/staff-management.store.server'
import { createStaffSelfReader } from './infrastructure/adapters/staff-self.reader'
import {
  createGrantAccessLookup,
  createPropertyGrantHolderLookup,
} from './infrastructure/adapters/grant-access-lookup.adapter'
import { createIdentityAssetReferences } from './infrastructure/adapters/identity-asset-references.adapter'
import { deliverBetaFeedback } from './feedback/beta-feedback-sentry-delivery.adapter.server'
import { BetaFeedbackTriageRepository } from './infrastructure/beta-feedback-triage.repository'
import { findBetaFeedbackReporterContact } from './infrastructure/beta-feedback-reporter'
import { createAssignedPortalLookup } from './infrastructure/assigned-portal-lookup'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { isAcceptanceAdmitted } from './members/invitation-admission.adapter.server'
import { createInvitationReadModel } from './members/invitation-read-model.server'
import { createInvitedRegistrationStore } from './members/invited-registration-store.server'
import { createMemberPropertyAccessStore } from './members/member-property-access-store.server'
import {
  createMerchantAiManagementAuthorizer,
  createStepUpVerifier,
} from './consent/merchant-ai-management.server'
import {
  merchantAiPauseReason,
  merchantAiRenewalDecision,
} from './consent/merchant-ai-pause-reason.server'
import { createPlatformOrganizationStore } from './operator/platform-organization-store.server'
import { createPostgresPolicyAdminCommandStore } from './infrastructure/policy-admin-command-store'
import { buildCapabilityPolicyHandle } from './infrastructure/policy-store-init'
import { createPrimaryStaffAttributionResolver } from './staff/primary-staff-attribution.server'
import { createOrganizationCapabilityRefusalReaders } from './infrastructure/repositories/capability-refusal.repository'
import {
  getMemberRole,
  createManagerMembershipRepository,
} from './infrastructure/repositories/manager-membership.repository'
import {
  decideCurrentManagerPropertyAuthorities,
  decideCurrentManagerPropertyAuthority,
  createMemberPropertyAuthorityLookup,
  decidePublicationActorAuthority,
  resolveMemberPermissionPropertyScope,
} from './infrastructure/repositories/member-property-authority'
import { createMerchantAiAuthorizationStore } from './consent/merchant-ai-authorization.repository.server'
import { createMerchantAiDecisionDeferralStore } from './consent/merchant-ai-decision.repository.server'
import { createMerchantAiNoticeUpdateStore } from './consent/merchant-ai-notice-updates.repository.server'
import { createMerchantAiOverviewReader } from './consent/merchant-ai-overview.repository.server'
import { createStandingRenewalStore } from './consent/merchant-ai-standing-renewal.repository.server'
import { createProductUpdatesStore } from './updates/product-updates.repository.server'
import { hasActiveGrant } from './infrastructure/repositories/property-access-grant.repository'
import { createStaffParticipationRepository } from './infrastructure/repositories/staff-participation.repository'
import { createStaffAccountStore } from './staff/staff-account-store.server'

type AuthSession = Readonly<{
  setActiveOrganization: (organizationId: string) => Promise<void>
  updateOrganization: (data: Record<string, unknown>) => Promise<void>
  currentOrganizationName: () => Promise<string | null>
  verifyPassword: (
    input: Readonly<{ headers: Headers; password: string }>,
  ) => Promise<boolean>
}>

export type StaffAccountBindings = Pick<
  ManageStaffDeps,
  | 'staffScanTargetsEnabled'
  | 'authorizeProperty'
  | 'portals'
  | 'spendInvitationBudget'
  | 'invitationBudget'
  | 'deliverAccess'
  | 'spendAddressCheckBudget'
>

type IdentityContextDeps = Readonly<{
  staffAccounts?: StaffAccountBindings
  db: Database
  replyEffects: ReplyScopeEffects
  identityPort: IdentityPort
  clock: Clock
  idGen: () => string
  /**
   * The authenticated session dependency: the operations the root used to
   * perform inline against the better-auth process singleton.
   */
  authSession: AuthSession
  /**
   * Deletes one stored avatar or logo object. Late-bound by the composition
   * root: the object store is built with Portal, after Identity.
   */
  deleteAssetObject: (key: string) => Promise<void>
  /** Send an invitation email. */
  sendEmail: InvitationEmailSender
  /** Base URL for building invitation links. */
  baseUrl: string
  /** Invitation lifetime in ms (INVITATION_EXPIRY_SECONDS in shared/auth/auth). */
  invitationExpiresInMs: number
  /** Property display names, from the Property public API (composition). */
  propertyNames: PropertyNameLookup
  /** Logger supplied by the process composition boundary. */
  logger: LoggerPort
  /** Keys the content-free beta-feedback telemetry pseudonyms. */
  betaFeedbackHmacSecret: string
  /**
   * Capability-policy wiring. Identity owns the persisted policy store
   * (readiness) and the least-privilege admin ops; the composition root
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
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

export type PlatformConsoleDeps = Readonly<{
  db: Database
  clock: Clock
  idGen: () => string
  logger: LoggerPort
  sendEmail: InvitationEmailSender
  baseUrl: string
  invitationExpiresInMs: number
}>

export type PlatformConsole = Readonly<{
  listOrganizations: ListPlatformOrganizations
  provisionOrganization: ProvisionOrganization
  inviteAdmin: InviteOrganizationAdmin
  resendInvitation: ResendOrganizationAdminInvitation
  cancelInvitation: CancelOrganizationAdminInvitation
}>

/**
 * The platform operator console: only its server functions reach it, after
 * requirePlatformOperator. Its store runs the ordinary invitation commands
 * inside its own audited transactions.
 */
export function buildPlatformConsole(deps: PlatformConsoleDeps): PlatformConsole {
  const store = createPlatformOrganizationStore(deps.db, deps.idGen)
  const { clock, logger } = deps
  const email = {
    sendEmail: deps.sendEmail,
    baseUrl: deps.baseUrl,
    invitationExpiresInMs: deps.invitationExpiresInMs,
    logger,
  } as const

  return Object.freeze({
    listOrganizations: listPlatformOrganizations({
      store,
      clock,
    }),
    provisionOrganization: provisionOrganization({
      ...email,
      store,
      clock,
      newOrganizationId: () => organizationId(deps.idGen()),
      newInvitationId: () => invitationId(deps.idGen()),
    }),
    inviteAdmin: inviteOrganizationAdmin({
      ...email,
      store,
      clock,
      idGen: () => invitationId(deps.idGen()),
    }),
    resendInvitation: resendOrganizationAdminInvitation({ ...email, store, clock }),
    cancelInvitation: cancelOrganizationAdminInvitation({ store, clock, logger }),
  })
}

const unavailable = async (): Promise<never> => {
  throw new Error('Staff account bindings are unavailable')
}

const unavailableStaffAccountBindings: StaffAccountBindings = {
  authorizeProperty: unavailable,
  portals: {
    archiveForMemberDeparture: unavailable,
    rename: unavailable,
    check: unavailable,
    create: unavailable,
    issueCode: unavailable,
    publish: unavailable,
    archive: unavailable,
  },
  spendInvitationBudget: unavailable,
  invitationBudget: unavailable,
  deliverAccess: unavailable,
  spendAddressCheckBudget: unavailable,
}

function buildStaffAccounts(
  deps: Pick<IdentityContextDeps, 'db' | 'clock' | 'idGen' | 'logger' | 'staffAccounts'> &
    Readonly<{ commandStore: IdentityCommandStore }>,
) {
  const { db, clock, logger } = deps
  const management = createStaffManagementStore(db, clock)
  const input: ManageStaffDeps = {
    store: createStaffAccountStore(db, clock, { connect: () => db.$client.connect() }),
    management,
    idGen: deps.idGen,
    ...(deps.staffAccounts ?? unavailableStaffAccountBindings),
    reportAddressRefusal: (reason) =>
      logger.warn({ security: true, reason }, 'Staff address refused'),
    reportStepFailure: (row, error) =>
      logger.warn(
        { correlationId: row.id, reason: staffFailureDiagnostic(row, error) },
        'Staff setup step failed',
      ),
    reportDeliveryFailure: (row) =>
      logger.warn({ correlationId: row.id }, 'Staff access email delivery failed'),
    // A login already gone is the outcome the caller wanted.
    removeLogin: async (memberId, targetUserId, ctx) => {
      try {
        await deps.commandStore.removeMember({
          organizationId: ctx.organizationId,
          memberId,
          staffOnly: true,
          event: identityMemberRemoved({
            organizationId: ctx.organizationId,
            userId: userId(targetUserId),
            removedBy: ctx.userId,
            occurredAt: clock(),
          }),
        })
      } catch (error) {
        const hasCode = typeof error === 'object' && error !== null && 'code' in error
        if (!hasCode || error.code !== 'member_not_found') throw error
      }
    },
  }
  return Object.freeze({
    removeForMemberDeparture: removeStaffForMemberDeparture(input),
    checkStaffSource: checkStaffSource(input),
    checkStaffBatch: checkStaffBatch(input),
    addStaffMember: addStaffMember(input),
    removeStaffMember: removeStaffMember(input),
    renameStaffMember: renameStaffMember(input),
    listStaffMembers: listStaffMembers(input),
    setColleagueListEnabled: setColleagueListEnabled(input),
    resendStaffInvitation: resendStaffInvitation(input),
    changeStaffInvitationEmail: changeStaffInvitationEmail(input),
    propertyForParticipation: async (participationId: string, ctx: AuthContext) =>
      (await management.target(ctx.organizationId, participationId))?.propertyId ?? null,
  })
}

const MERCHANT_AI_GRANT_POLICY = {
  sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
} as const

/**
 * Merchant AI: authorization, decision deferral, the overview read, notice
 * updates and the standing renewal job, over one shared management check.
 */
function buildMerchantAi(
  deps: Pick<
    IdentityContextDeps,
    'db' | 'replyEffects' | 'idGen' | 'clock' | 'logger' | 'authSession'
  > &
    Readonly<{
      refreshPolicyRequired: () => Promise<unknown>
      isCurrentAccountAdmin: (
        input: Readonly<{ organizationId: string; userId: string }>,
      ) => Promise<boolean>
    }>,
) {
  const { db, clock, idGen } = deps
  const noticeUpdateReceipts = createMerchantAiNoticeUpdateStore(db)
  const decisionDeferrals = createMerchantAiDecisionDeferralStore(db)
  const authorizeManagement = createMerchantAiManagementAuthorizer(db)
  const isNoticeAdmin = async (input: { organizationId: string; actorUserId: string }) =>
    (await getMemberRole(db, input.organizationId, input.actorUserId)) === 'owner'

  const authorization = createMerchantAiAuthorization({
    store: createMerchantAiAuthorizationStore(db, idGen, deps.replyEffects),
    decisionDeferrals,
    authorizeManagement,
    authorize: async (input) => {
      await deps.refreshPolicyRequired()
      return checkScopedCapability(
        { organizationId: input.organizationId, propertyId: input.propertyId },
        input.capability,
      ).allowed
    },
    isCurrentAccountAdmin: ({ organizationId: orgId, actorUserId }) =>
      deps.isCurrentAccountAdmin({ organizationId: orgId, userId: actorUserId }),
    verifyStepUp: createStepUpVerifier(deps.authSession.verifyPassword),
    clock,
    idGen,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    ...MERCHANT_AI_GRANT_POLICY,
  })
  const deferral = createMerchantAiDecisionDeferral({
    store: decisionDeferrals,
    authorizeManagement,
    clock,
  })
  const overview = listMerchantAiOverview({
    reader: createMerchantAiOverviewReader(db),
    // The same ai.manage authority as each Property command, resolved once.
    resolveManagementScope: (input) =>
      resolveMemberPermissionPropertyScope(db, {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        permission: 'ai.manage',
        at: input.now,
      }),
    clock,
    isNoticeInForce: isMerchantAiNoticeInForceForCapabilities,
    readLatestUpdate: async (input) =>
      (await isNoticeAdmin(input))
        ? noticeUpdateReceipts.latest({ ...input, unseenOnly: false })
        : null,
    pauseReason: merchantAiPauseReason,
  })

  return {
    request: Object.freeze({
      get: authorization.get,
      enable: authorization.enable,
      enableForProperties: authorization.enableForProperties,
      change: authorization.change,
      revoke: authorization.revoke,
      defer: deferral.defer,
      listOverview: overview,
    }),
    noticeUpdates: createMerchantAiNoticeUpdates({
      store: noticeUpdateReceipts,
      isCurrentAccountAdmin: isNoticeAdmin,
    }),
    renewal: renewLapsedMerchantAiAuthorizations({
      idGen,
      clock,
      logger: deps.logger,
      store: createStandingRenewalStore({
        db,
        idGen,
        replyEffects: deps.replyEffects,
        policy: {
          noticeVersion: MERCHANT_AI_NOTICE.version,
          noticeDigest: MERCHANT_AI_NOTICE.digest,
          ...MERCHANT_AI_GRANT_POLICY,
        },
        authorize: async (input) => merchantAiRenewalDecision(input),
      }),
      target: {
        noticeVersion: MERCHANT_AI_NOTICE.version,
        noticeDigest: MERCHANT_AI_NOTICE.digest,
      },
      captureUnexpected: (error) =>
        captureObservabilityException(error, {
          source: 'bullmq-job',
          jobName: 'merchant-ai-standing-renewal',
        }),
    }),
  }
}

function buildPeopleSurface(deps: Pick<IdentityContextDeps, 'db' | 'clock' | 'idGen'>) {
  const accessiblePropertyLookup = createGrantAccessLookup(deps.db, deps.clock)
  const participationRepo = createStaffParticipationRepository(deps.db)
  const resolvePrimaryStaffAttribution = createPrimaryStaffAttributionResolver(deps.db)
  const participation = {
    repo: participationRepo,
    accessibleProperties: accessiblePropertyLookup,
    clock: deps.clock,
    idGen: deps.idGen,
  } as const

  const listAssignedPortalIds = createAssignedPortalLookup(participationRepo)

  return Object.freeze({
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
    ) => listAssignedPortalIds(ctx.organizationId, input.userId, input.propertyId),
    resolvePrimaryStaffAttribution,
    findParticipationById: (organizationId: OrganizationId, participationId: string) =>
      participationRepo.findById(organizationId, participationId),
    listActiveParticipations: (organizationId: OrganizationId, propertyId: PropertyId) =>
      participationRepo.list(organizationId, { propertyId, activeOnly: true }),
    management: Object.freeze({
      createStaffParticipation: createStaffParticipation(participation),
      listStaffParticipations: listStaffParticipations(participation),
      archiveStaffParticipation: archiveStaffParticipation(participation),
      updatePortalResponsibilities: updatePortalResponsibilities(participation),
    }),
  })
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
  const { db, clock, logger, identityPort } = deps
  // The People surface comes first in the load-bearing construction order and
  // shares Identity's grant authority.
  const people = buildPeopleSurface(deps)

  const managerMembershipRepo = createManagerMembershipRepository(
    db,
    async ({ organizationId: orgId, userId: memberUserId, memberRole }) => {
      const { context } = await resolveMemberAuthContextWithDatabase(db, {
        organizationId: orgId,
        userId: memberUserId,
        memberRole,
      })
      if (!canForContext(context, 'property.read')) return null
      const scope = scopeForPermission(context, 'property.read')
      return scope === 'none' ? null : scope
    },
  )
  // Every identity state mutation and its fact commit atomically here.
  const commandStore = createAtomicIdentityCommandStore(db, deps.idGen, (orgId) =>
    isAcceptanceAdmitted('staff.accounts', orgId, clock()),
  )

  // A joiner has no tenant context yet, so acceptance and registration are
  // admitted by the execution policy for the invitation's Organization. The
  // recovery job brings the authorizer of its own schedule to each pass.
  const invitations = createInvitationReadModel(db)
  const registrationStore = createInvitedRegistrationStore(db)
  const admission = {
    invitations,
    authorizeOrganization: (orgId: OrganizationId) =>
      isAcceptanceAdmitted('identity.invite', orgId, clock()),
  } as const
  // What both sends (invite, resend) need to compose and mail the invitation.
  const emailDelivery = {
    identity: identityPort,
    sendEmail: deps.sendEmail,
    getOrganizationName: async (_ctx: AuthContext): Promise<string> =>
      (await deps.authSession.currentOrganizationName()) ?? 'Unknown Organization',
    propertyNames: deps.propertyNames,
    baseUrl: deps.baseUrl,
    invitationExpiresInMs: deps.invitationExpiresInMs,
    logger,
  } as const

  const memberPropertyAccessStore = createMemberPropertyAccessStore(db)
  const assetReferences = createIdentityAssetReferences(db)

  // Capability fate and environment controls are process-static. Tenant
  // grants, consent, and the execution kill switch retain their live reads.
  const policyStore = buildCapabilityPolicyHandle({
    db,
    env: deps.policy.env,
    clock,
  })
  const merchantAi = buildMerchantAi({
    ...deps,
    refreshPolicyRequired: policyStore.refreshRequired,
    isCurrentAccountAdmin: managerMembershipRepo.isCurrentAccountAdmin,
  })

  // PropertyAccessGrant administration. Capability configuration is immutable
  // for the process and has no table-backed admin mutations.
  const policyDiagnostic = createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(db, input),
  })
  const policyAdmin = Object.freeze({
    ...createPolicyAdminOps({
      explainPolicyDecision: (input) => policyDiagnostic(input),
      commandStore: createPostgresPolicyAdminCommandStore(db),
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
    }),
    // Every AccountAdmin reaches this report, so its permit tally is tenant-bound.
    explainCapabilityRefusal: createCapabilityRefusalExplainer(
      createOrganizationCapabilityRefusalReaders(db),
    ),
  })

  const staffAccounts = buildStaffAccounts({ ...deps, commandStore })
  const memberRoleCleanup = roleChangeCleanup({
    commandStore,
    reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
  })

  const requests = Object.freeze({
    inviteMember: inviteMember({
      ...emailDelivery,
      commandStore,
      clock,
      idGen: () => invitationId(deps.idGen()),
    }),
    updateMemberRole: updateMemberRole({
      identity: identityPort,
      commandStore,
      clock,
      cleanup: memberRoleCleanup,
    }),
    removeMember: removeMember({
      removeStaffForMemberDeparture: staffAccounts.removeForMemberDeparture,
      identity: identityPort,
      commandStore,
      clock,
    }),
    listInvitations: listInvitations({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    resendInvitation: resendInvitation({ ...emailDelivery, commandStore, clock }),
    acceptInvitation: acceptInvitation({
      ...admission,
      identity: identityPort,
      commandStore,
      clock,
      logger,
    }),
    cancelInvitation: cancelInvitation({ commandStore, clock }),
    getInvitationPreview: getInvitationPreview({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    registerInvitedUser: registerInvitedUser({
      ...admission,
      commandStore,
      registrationStore,
      signUp: identityPort.signUp,
      idGen: deps.idGen,
      clock,
      logger,
    }),
    updateOrganization: updateOrganization({
      updateOrg: deps.authSession.updateOrganization,
      // A removed logo is freed from the store once the removal is saved.
      currentLogo: assetReferences.currentOrganizationLogo,
      retireReplaced: retireReplacedIdentityAsset({
        storage: { deleteObject: deps.deleteAssetObject },
        logger,
      }),
    }),
    merchantAiAuthorization: merchantAi.request,
    merchantAiNoticeUpdates: merchantAi.noticeUpdates,
    setMemberPropertyAccess: setMemberPropertyAccess({
      identity: identityPort,
      store: memberPropertyAccessStore,
      clock,
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
    }),
    listMemberPropertyAccess: listMemberPropertyAccess({
      store: memberPropertyAccessStore,
      clock,
    }),
  })

  return {
    publicApi: Object.freeze({
      managerFacts: Object.freeze({
        listActiveManagers: managerMembershipRepo.listActiveManagers,
        /**
         * Whether a member may act on an approval request for one Property,
         * under the same effective-permission model an interactive approval
         * uses. Feed asks this to route "Approve a reply" to people who can
         * actually approve; it takes no locks and decides nothing.
         */
        canApproveReplies: createMemberPropertyAuthorityLookup(db, 'reply.manage', clock),
      }),
      accountAdminAuthority: Object.freeze({
        isCurrentAccountAdmin: managerMembershipRepo.isCurrentAccountAdmin,
      }),
      people: Object.freeze(people),
      staffSelf: Object.freeze(createStaffSelfReader(db, clock)),
      staffAccounts,
      requests,
    }),
    worker: Object.freeze({
      recoverInvitedRegistrations: recoverInvitedRegistrations({
        commandStore,
        registrationStore,
        clock,
        logger,
      }),
      renewLapsedMerchantAiAuthorizations: merchantAi.renewal,
      registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) =>
        registerMemberRoleConsumers(consumerRegistry, { cleanup: memberRoleCleanup }),
    }),
    /** Capability-policy control plane owned by Identity. */
    policy: Object.freeze({
      admin: policyAdmin,
      // Static policy is already current; these async no-ops preserve the
      // deployment boot/readiness contract without a background poller.
      refresh: policyStore.refresh,
      refreshRequired: policyStore.refreshRequired,
      currentVersion: policyStore.currentVersion,
      // Container-owned policy objects: building identity does not install
      // them process-wide; an entry point binds exactly one set.
      capabilityPolicyStore: policyStore.capabilityPolicyStore,
      executionPolicy: policyStore.executionPolicy,
      delayedExecutionPolicy: policyStore.delayedExecutionPolicy,
    }),
    /** Authority decisions and grant facts other contexts must ask Identity for. */
    authority: Object.freeze({
      // Callers supply their authorization transaction so each decision shares
      // their commit check; the grant table stays Identity's.
      hasActivePropertyGrant: hasActiveGrant,
      decideManagerPropertyAuthority: decideCurrentManagerPropertyAuthority,
      decideManagerPropertyAuthorities: decideCurrentManagerPropertyAuthorities,
      decidePublicationActorAuthority,
      // Property-scoped recipient resolution for other contexts (notification
      // fan-out).
      propertyAccessHolders: createPropertyGrantHolderLookup(db, clock),
    }),
    /** Beta-feedback reporting for the signed-in reporter. Request-facing, but
     * kept off `publicApi`, which other contexts receive. */
    betaFeedback: buildBetaFeedbackRequests(deps),
    /** What still points at an uploaded avatar or logo. Request-facing, so kept off `publicApi`. */
    assetReferences,
    productUpdates: createProductUpdates({
      store: createProductUpdatesStore(db),
      clock,
      hasCapability: ({ actor, propertyId }, capability) =>
        checkScopedCapability(
          { organizationId: actor.organizationId, propertyId },
          capability,
        ).allowed,
    }),
  } as const
}
