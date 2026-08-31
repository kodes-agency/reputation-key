import { describe, expect, it, vi } from 'vitest'
import { createContactRequestResponseAuthorityAdapter } from './contact-request-response-authority.adapter'
import type { ContactRequestSessionAuthorityPort } from '../../application/ports/contact-request-session-authority.port'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const SCOPE = Object.freeze({
  organizationId: 'org-contact-authority',
  propertyId: '10000000-0000-4000-8000-000000000001',
  portalId: '10000000-0000-4000-8000-000000000002',
})
const RESPONSE_ID = '10000000-0000-4000-8000-000000000003'
const SESSION = Object.freeze({
  sessionId: 'session-1',
  csrfNonce: '10000000-0000-4000-8000-000000000004',
  ...SCOPE,
  tokenVersion: 0,
  issuedAt: new Date('2026-08-28T11:00:00.000Z'),
  expiresAt: new Date('2026-08-29T11:00:00.000Z'),
  campaignMediumHint: null,
  guestLocale: 'en' as const,
})

const response = (overrides: Record<string, unknown> = {}) =>
  ({
    id: RESPONSE_ID,
    status: 'submitted',
    responseConsent: true,
    deletedAt: null,
    ...overrides,
  }) as never

const setup = (input?: {
  verifiedSession?: typeof SESSION | null
  csrfValid?: boolean
  foundResponse?: ReturnType<typeof response> | null
}) => {
  const sessions = {
    verify: vi.fn(() =>
      input?.verifiedSession === undefined ? SESSION : input.verifiedSession,
    ),
    verifyCsrf: vi.fn(() => input?.csrfValid ?? true),
  } as unknown as ContactRequestSessionAuthorityPort
  const responses = {
    findForSession: vi.fn(async () =>
      input?.foundResponse === undefined ? response() : input.foundResponse,
    ),
  } as unknown as Pick<GuestResponseRepository, 'findForSession'>
  const authority = createContactRequestResponseAuthorityAdapter({ sessions, responses })
  return { authority, sessions, responses }
}

const authorize = (action: 'submit' | 'withdraw' = 'submit') => ({
  action,
  scope: SCOPE,
  responseId: RESPONSE_ID,
  authority: {
    signedSession: 'rk_guest_session=signed-cookie-value',
    csrfNonce: SESSION.csrfNonce,
  },
  at: NOW,
})

describe('Contact Request response authority adapter', () => {
  it.each(['submit', 'withdraw'] as const)(
    'authorizes %s only through the exact live signed-session response binding',
    async (action) => {
      const { authority, sessions, responses } = setup()

      await expect(authority.authorize(authorize(action))).resolves.toBe(true)
      expect(sessions.verify).toHaveBeenCalledWith(
        'rk_guest_session=signed-cookie-value',
        SCOPE,
      )
      expect(sessions.verifyCsrf).toHaveBeenCalledWith(SESSION, SESSION.csrfNonce)
      expect(responses.findForSession).toHaveBeenCalledWith(SCOPE, SESSION.sessionId, NOW)
    },
  )

  it('fails closed before reading a response when signature or CSRF authority is invalid', async () => {
    const unsigned = setup({ verifiedSession: null })
    await expect(unsigned.authority.authorize(authorize())).resolves.toBe(false)
    expect(unsigned.responses.findForSession).not.toHaveBeenCalled()

    const wrongCsrf = setup({ csrfValid: false })
    await expect(wrongCsrf.authority.authorize(authorize())).resolves.toBe(false)
    expect(wrongCsrf.responses.findForSession).not.toHaveBeenCalled()
  })

  it.each([
    ['missing binding', null],
    ['different response', response({ id: '10000000-0000-4000-8000-000000000099' })],
    ['terminal response', response({ status: 'deleted', deletedAt: NOW })],
    ['withdrawn response consent', response({ responseConsent: false })],
  ] as const)('denies a %s', async (_case, foundResponse) => {
    const { authority } = setup({ foundResponse })

    await expect(authority.authorize(authorize())).resolves.toBe(false)
  })
})
