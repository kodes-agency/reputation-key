import type {
  IdentityAccountAdminAuthorityPublicApi,
  IdentityManagerFactsPublicApi,
} from '#/contexts/identity/application/public-api'
import type { PortalContactRequestManagerAuthorityPublicApi } from '#/contexts/portal/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { ContactRequestManagerAuthorityPort } from '../../application/ports/contact-request-manager-authority.port'

type ContactRequestManagerAuthorityDeps = Readonly<{
  portal: PortalContactRequestManagerAuthorityPublicApi
  managerFacts: IdentityManagerFactsPublicApi
  accountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
  staff: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
}>

export const createContactRequestManagerAuthorityAdapter = (
  deps: ContactRequestManagerAuthorityDeps,
): ContactRequestManagerAuthorityPort => ({
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
