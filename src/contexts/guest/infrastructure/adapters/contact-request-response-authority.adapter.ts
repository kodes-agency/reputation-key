import type { ContactRequestResponseAuthorityPort } from '../../application/ports/contact-request-response-authority.port'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'
import type { ContactRequestSessionAuthorityPort } from '../../application/ports/contact-request-session-authority.port'

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
      input.scope,
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
