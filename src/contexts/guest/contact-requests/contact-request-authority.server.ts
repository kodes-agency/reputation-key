import type {
  IdentityAccountAdminAuthorityPublicApi,
  IdentityManagerFactsPublicApi,
  StaffPublicApi,
} from '#/contexts/identity/application/public-api'
import type { PortalContactRequestManagerAuthorityPublicApi } from '#/contexts/portal/application/public-api'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { GuestSession } from '../domain/guest-session'
import type { GuestResponseRepository } from '../application/ports/guest-response.repository'
import type {
  ContactRequestGuestAuthority,
  ContactRequestManagerAuthorityBasis,
  ContactRequestScope,
} from './contracts'

/** Signed-cookie and CSRF verification owned by Guest's public session boundary. */
type ContactRequestSessions = Readonly<{
  verify(cookieHeader: string, scope: ContactRequestScope): GuestSession | null
  verifyCsrf(session: GuestSession, presented: string): boolean
}>

/**
 * Public response authority: signed-session verification, CSRF comparison and
 * binding to the guest's own response. It names the response, so a guest can
 * act only on the one their session holds.
 */
export type ContactRequestAuthorityAction = 'submit' | 'withdraw'

export type ContactRequestResponseAuthority = Readonly<{
  authorize(input: {
    action: ContactRequestAuthorityAction
    scope: ContactRequestScope
    authority: ContactRequestGuestAuthority
    at: Date
  }): Promise<string | null>
}>

export const createContactRequestResponseAuthority = (
  deps: Readonly<{
    sessions: ContactRequestSessions
    responses: Pick<GuestResponseRepository, 'findForSession'>
  }>,
): ContactRequestResponseAuthority => ({
  authorize: async (input) => {
    const session = deps.sessions.verify(input.authority.signedSession, input.scope)
    if (!session || !deps.sessions.verifyCsrf(session, input.authority.csrfNonce)) {
      return null
    }

    const response = await deps.responses.findForSession(
      {
        organizationId: organizationId(input.scope.organizationId),
        propertyId: propertyId(input.scope.propertyId),
        portalId: portalId(input.scope.portalId),
      },
      session.sessionId,
      input.at,
    )
    if (!response || !response.responseConsent || response.deletedAt !== null) {
      return null
    }

    const live = response.status === 'submitted' || response.status === 'corrected'
    const allowed =
      input.action === 'submit' ? live : live || response.status === 'moderated'
    return allowed ? response.id : null
  },
})

/**
 * Manager relationships are owned by Identity, Staff and Portal. Each call
 * reads them fresh for the exact scope and instant supplied. The contact row
 * is locked in a separate transaction, so a revocation can land between this
 * read and the masked read or reveal; the reveal audit records the basis that
 * was current when the reveal was allowed.
 */
export type ContactRequestManagerAuthority = Readonly<{
  resolve(input: {
    scope: ContactRequestScope
    actorId: string
    at: Date
  }): Promise<ContactRequestManagerAuthorityBasis | null>
}>

export const createContactRequestManagerAuthority = (
  deps: Readonly<{
    portal: PortalContactRequestManagerAuthorityPublicApi
    managerFacts: IdentityManagerFactsPublicApi
    accountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
    staff: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
  }>,
): ContactRequestManagerAuthority => ({
  resolve: async ({ scope, actorId }) => {
    const orgId = organizationId(scope.organizationId)
    const pid = portalId(scope.portalId)
    const property = propertyId(scope.propertyId)
    const actor = userId(actorId)
    const facts = await deps.portal.getContactRequestManagerAuthorityFacts(orgId, pid)
    if (!facts || facts.propertyId !== property) return null

    if (
      await deps.accountAdminAuthority.isCurrentAccountAdmin({
        organizationId: scope.organizationId,
        userId: actorId,
      })
    ) {
      return 'account_admin'
    }

    const memberships = await deps.managerFacts.listActiveManagers(scope.organizationId)
    const membership = memberships.find((candidate) => candidate.userId === actorId)
    // `listActiveManagers` returns only current manager memberships. A current
    // AccountAdmin was already proven through the dedicated authority above;
    // the assigned-Property scope is therefore the authorization fact needed
    // here, without making an active decision from a display role label.
    if (membership?.propertyAccessScope !== 'assigned-properties') {
      return null
    }
    const accessible = await deps.staff.getAccessiblePropertyIds(orgId, actor, false)
    if (!accessible?.includes(property)) return null

    if (facts.creatorUserId === actor) return 'portal_creator'
    return facts.responsibleManagerUserIds.includes(actor) ? 'responsible_manager' : null
  },
})
