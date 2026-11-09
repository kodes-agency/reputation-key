import { randomUUID } from 'node:crypto'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { createStaffInvitationBudget } from '#/contexts/identity/build-staff-accounts'
import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'
import { createTanstackRequestContext } from '#/shared/auth/tanstack-request-context'
import { createBetterAuthSessionPort } from '#/shared/auth/better-auth-session'
import { buildPlatformConsole } from '#/contexts/identity/build-platform'
import { isOrgInAllowlist } from '#/shared/auth/beta-capabilities'
import { buildIdentityContext } from '#/contexts/identity/build'
import { INVITATION_EXPIRY_SECONDS } from '#/shared/auth/auth'
import { sendInvitationEmail, sendStaffCodeReadyEmail } from '#/shared/auth/emails'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { reputationReplyScopeEffects } from './reply-scope-effects'
import { composeOrganizationLifecycle } from './organization-export-contributors'
import type { CompositionRuntime, ContextWiringInput } from './runtime'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { IntegrationContextApi } from '#/contexts/integration/build'
import type { createDeferredMemberAuthorityLifecycle } from './member-authority-lifecycle'

const PROPERTY_ID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function buildIdentityPorts({ options, db, logger }: CompositionRuntime) {
  // Identity port (adapter).
  // ARC-03-T13: the framework/provider seam is selected HERE and injected
  // everywhere else. No context and no other root line calls getRequest() or
  // the better-auth process singleton.
  const observeAbsentRequest = (err: unknown): void => {
    logger.debug({ err }, 'no server request context available, using empty headers')
  }
  const requestContext =
    options?.requestContext ?? createTanstackRequestContext({ observeAbsentRequest })
  const authSession =
    options?.authSession ?? createBetterAuthSessionPort({ requestContext })
  const identityPort = options?.identityPort ?? createBetterAuthIdentityAdapter(db)
  return { authSession, identityPort }
}

export function wireIdentity(
  { options, db, clock, logger, env, infra }: ContextWiringInput,
  { authSession, identityPort }: ReturnType<typeof buildIdentityPorts>,
  memberAuthorityLifecycle: ReturnType<typeof createDeferredMemberAuthorityLifecycle>,
  getProperty: () => ReturnType<typeof buildPropertyContext>,
  getPortal: () => ReturnType<typeof buildPortalContext>,
  getIntegration: () => IntegrationContextApi,
) {
  const staffInvitationBudget = createStaffInvitationBudget(
    infra.rateLimiter,
    env.BETTER_AUTH_SECRET,
  )
  const identity = buildIdentityContext({
    replyEffects: reputationReplyScopeEffects,
    staffAccounts: {
      staffScanTargetsEnabled: env.STAFF_SCAN_TARGETS_ENABLED,
      authorizeProperty: (ctx, propertyId, action) =>
        requireExecutionAllowed({
          actor: ctx,
          propertyId,
          action,
          capability: 'staff.accounts',
        }),
      portals: {
        archiveForMemberDeparture: async (portalIdValue, ctx) => {
          await getPortal().publicApi.management.archivePersonalPortalForMemberDeparture(
            { portalId: portalIdValue },
            ctx,
          )
        },
        rename: (input, ctx, transaction) =>
          getPortal().publicApi.management.renamePersonalPortalLabels(
            input,
            ctx,
            transaction,
          ),
        check: async (input, ctx) => ({
          omittedLinks:
            (await getPortal().publicApi.management.checkPersonalPortalSource(input, ctx))
              ?.omittedLinks ?? [],
        }),
        create: async (input, ctx) => {
          await getPortal().publicApi.management.createPersonalPortal(input, ctx)
        },
        issueCode: (portalIdValue, ctx) =>
          getPortal().publicApi.management.ensurePersonalPortalToken(
            { portalId: portalIdValue },
            ctx,
          ),
        publish: async (portalIdValue, ctx) => {
          await getPortal().publicApi.management.publishPortal(
            { portalId: portalIdValue },
            ctx,
          )
        },
        archive: async (portalIdValue, ctx) => {
          await getPortal().publicApi.management.archivePersonalPortal(
            { portalId: portalIdValue },
            ctx,
          )
        },
      },
      spendInvitationBudget: staffInvitationBudget.spend,
      spendAddressCheckBudget: staffInvitationBudget.checkAddresses,
      invitationBudget: staffInvitationBudget.remaining,
      deliverAccess: async (row, access) => {
        if (!row.email) return
        const names = await getProperty().publicApi.getPropertyNames(
          organizationId(row.organizationId),
          [propertyId(row.propertyId)],
        )
        const propertyName = names[0]?.name ?? 'your Property'
        if (access.invited)
          await (options?.email ?? sendInvitationEmail)({
            email: row.email,
            invitedByUsername: 'Your manager',
            organizationName: propertyName,
            inviteLink: new URL(
              `/accept-invitation?id=${row.invitationId}`,
              env.BETTER_AUTH_URL,
            ).href,
            role: 'Member',
            propertyNames: [],
            expiresInDays: 7,
          })
        else
          await sendStaffCodeReadyEmail(
            row.email,
            propertyName,
            new URL('/login', env.BETTER_AUTH_URL).href,
          )
      },
    },
    db,
    identityPort,
    clock,
    idGen: randomUUID,
    authSession,
    // Late-bound: the shared object store is built with Portal, below.
    deleteAssetObject: (key) => getPortal().uploads.storage.deleteObject(key),
    sendEmail: options?.email ?? sendInvitationEmail,
    baseUrl: env.BETTER_AUTH_URL,
    invitationExpiresInMs: INVITATION_EXPIRY_SECONDS * 1000,
    // Late-bound like the policy check below. Invitations store Property ids
    // as free text; only a UUID can name a Property row.
    propertyNames: (orgId, ids) =>
      getProperty().publicApi.getPropertyNames(
        organizationId(orgId),
        ids.filter((id) => PROPERTY_ID_SHAPE.test(id)).map(propertyId),
      ),
    logger,
    betaFeedbackHmacSecret: env.BETTER_AUTH_SECRET,
    policy: {
      env,
      propertyBelongsToOrganization: (orgId, pid) =>
        getProperty().publicApi.propertyExists(organizationId(orgId), propertyId(pid)),
    },
    cancelGoogleImportsForUser: (orgId, userIdValue) => {
      const cancel = getIntegration().lifecycle.cancelImportsForUser
      if (!cancel) throw new Error('Google import lifecycle unavailable')
      return cancel(orgId, userIdValue).then(() => undefined)
    },
    prepareGoogleConnectorDeparture: async (orgId, userIdValue, cause) => {
      await getIntegration().lifecycle.prepareConnectorDeparture({
        organizationId: organizationId(orgId),
        connectorUserId: userId(userIdValue),
        cause,
      })
    },
    releaseMemberAuthorities: memberAuthorityLifecycle.port.releaseMemberAuthorities,
    reconcileResponsibleManagerEligibility:
      memberAuthorityLifecycle.port.reconcileResponsibleManagerEligibility,
    organizationLifecycle: composeOrganizationLifecycle(
      db,
      options?.organizationLifecycle,
    ),
  })

  return identity
}

export function buildIdentityPlatform({
  db,
  clock,
  logger,
  options,
  env,
}: CompositionRuntime) {
  return buildPlatformConsole({
    db,
    clock,
    idGen: randomUUID,
    logger,
    sendEmail: options?.email ?? sendInvitationEmail,
    baseUrl: env.BETTER_AUTH_URL,
    invitationExpiresInMs: INVITATION_EXPIRY_SECONDS * 1000,
    isControlledBetaEnabled: (id) => isOrgInAllowlist(env, id),
  })
}
