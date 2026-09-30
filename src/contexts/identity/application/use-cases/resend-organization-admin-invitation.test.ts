import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import type { InvitationEmail } from '../ports/invitation-email.port'
import type { RenewedInvitation } from '../ports/identity-command-store.port'
import type {
  OrganizationAdministration,
  PlatformOrganizationStore,
} from '../ports/platform-organization-store.port'
import type { PlatformOperatorActor } from '../dto/platform-console.dto'
import { resendOrganizationAdminInvitation } from './resend-organization-admin-invitation'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RENEWED_EXPIRY = new Date(NOW.getTime() + SEVEN_DAYS_MS)
const OPERATOR: PlatformOperatorActor = { userId: userId('user-operator'), name: 'Bo' }

const ownerless: OrganizationAdministration = {
  organizationId: organizationId('org-new'),
  name: 'Hotel Riviera',
  lifecycleState: 'active',
  accountAdminCount: 0,
  openAdminInvitationIds: [invitationId('inv-lapsed')],
}

function setup(administration: OrganizationAdministration | null = ownerless) {
  const store = {
    listOrganizations: vi.fn(),
    readAdministration: vi.fn(async () => administration),
    provisionOrganization: vi.fn(),
  } satisfies PlatformOrganizationStore
  const renewInvitation = vi.fn(async (): Promise<RenewedInvitation> => ({
    email: 'admin@riviera.example',
    role: 'owner',
    propertyIds: [],
    expiresAt: RENEWED_EXPIRY,
  }))
  const sent: InvitationEmail[] = []
  const sendEmail = vi.fn(async (email: InvitationEmail) => {
    sent.push(email)
  })
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  const resend = resendOrganizationAdminInvitation({
    store,
    commandStore: { renewInvitation },
    clock: () => NOW,
    invitationExpiresInMs: SEVEN_DAYS_MS,
    sendEmail,
    baseUrl: 'https://app.example.test',
    logger,
  })
  return { resend, store, renewInvitation, sendEmail, sent, logger }
}

const INPUT = { organizationId: 'org-new', invitationId: 'inv-lapsed' }

describe('resendOrganizationAdminInvitation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renews the same invitation, scoped to its Organization, for a full lifetime', async () => {
    const { resend, renewInvitation } = setup()

    await expect(resend(INPUT, OPERATOR)).resolves.toEqual({
      expiresAt: RENEWED_EXPIRY.toISOString(),
      emailSent: true,
    })
    expect(renewInvitation).toHaveBeenCalledWith({
      invitationId: 'inv-lapsed',
      organizationId: 'org-new',
      now: NOW,
      expiresAt: RENEWED_EXPIRY,
    })
  })

  it('mails the renewed address as an AccountAdmin invitation', async () => {
    const { resend, sent } = setup()

    await resend(INPUT, OPERATOR)

    expect(sent).toEqual([
      {
        email: 'admin@riviera.example',
        invitedByUsername: 'Bo',
        organizationName: 'Hotel Riviera',
        inviteLink: 'https://app.example.test/accept-invitation?id=inv-lapsed',
        role: 'AccountAdmin',
        propertyNames: [],
        expiresInDays: 7,
      },
    ])
  })

  it('logs the resend content-free: no identifiers, no address', async () => {
    const { resend, logger } = setup()

    await resend(INPUT, OPERATOR)

    expect(logger.info).toHaveBeenCalledWith(
      { event: 'platform.admin_invitation_resent' },
      expect.any(String),
    )
    const logged = JSON.stringify(logger.info.mock.calls)
    expect(logged).not.toMatch(/user-operator|org-new|inv-|@riviera/)
  })

  it.each([
    [
      'an invitation that is not an open AccountAdmin invitation of this Organization',
      { ...INPUT, invitationId: 'inv-other' },
      ownerless,
      'invitation_not_found',
    ],
    [
      'an Organization that already has an AccountAdmin',
      INPUT,
      { ...ownerless, accountAdminCount: 1 },
      'forbidden',
    ],
    [
      'an Organization that is not active',
      INPUT,
      { ...ownerless, lifecycleState: 'closure_requested' as const },
      'forbidden',
    ],
  ])('refuses %s without renewing', async (_label, input, administration, code) => {
    const { resend, renewInvitation, sendEmail } = setup(administration)

    await expect(resend(input, OPERATOR)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code,
    })
    expect(renewInvitation).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
