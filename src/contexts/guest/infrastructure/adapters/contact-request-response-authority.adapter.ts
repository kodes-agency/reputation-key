import type { ContactRequestResponseAuthorityPort } from '../../application/ports/contact-request-response-authority.port'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'
import type { ContactRequestSessionAuthorityPort } from '../../application/ports/contact-request-session-authority.port'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

type ContactRequestResponseAuthorityDeps = Readonly<{
  sessions: ContactRequestSessionAuthorityPort
  responses: Pick<GuestResponseRepository, 'findForSession'>
}>

export const createContactRequestResponseAuthorityAdapter = (
  deps: ContactRequestResponseAuthorityDeps,
): ContactRequestResponseAuthorityPort => ({
  authorize: async (input) => {
    const session = deps.sessions.verify(input.authority.signedSession, input.scope)
    if (!session || !deps.sessions.verifyCsrf(session, input.authority.csrfNonce)) {
      return false
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
    if (
      !response ||
      response.id !== input.responseId ||
      !response.responseConsent ||
      response.deletedAt !== null
    ) {
      return false
    }

    return input.action === 'submit'
      ? response.status === 'submitted' || response.status === 'corrected'
      : response.status === 'submitted' ||
          response.status === 'corrected' ||
          response.status === 'moderated'
  },
})
