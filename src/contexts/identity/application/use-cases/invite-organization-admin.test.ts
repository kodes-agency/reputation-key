import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import type { InvitationEmail } from '../ports/invitation-email.port'
import type {
  OrganizationAdministration,
  PlatformOrganizationStore,
} from '../ports/platform-organization-store.port'
import type { PlatformOperatorActor } from '../dto/platform-console.dto'
import { inviteOrganizationAdmin } from './invite-organization-admin'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const OPERATOR: PlatformOperatorActor = { userId: userId('user-operator'), name: 'Bo' }
const ORG = organizationId('org-new')

const ownerless: OrganizationAdministration = {
  organizationId: ORG,
  name: 'Hotel Riviera',
  lifecycleState: 'active',
  accountAdminCount: 0,
  openAdminInvitationIds: [],
}

function setup(administration: OrganizationAdministration | null = ownerless) {
  const store = {
    listOrganizations: vi.fn(),
    readAdministration: vi.fn(async () => administration),
    provisionOrganization: vi.fn(),
  } satisfies PlatformOrganizationStore
  const inviteMember = vi.fn(async () => {})
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
  const invite = inviteOrganizationAdmin({
    store,
    commandStore: { inviteMember },
    clock: () => NOW,
    idGen: () => invitationId('inv-1'),
    invitationExpiresInMs: SEVEN_DAYS_MS,
    sendEmail,
    baseUrl: 'https://app.example.test/',
    logger,
  })
  return { invite, store, inviteMember, sendEmail, sent, logger }
}

const INPUT = { organizationId: 'org-new', email: 'admin@riviera.example' }

describe('inviteOrganizationAdmin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invites an AccountAdmin through the ordinary command, the operator as inviter', async () => {
    const { invite, inviteMember } = setup()

    await expect(invite(INPUT, OPERATOR)).resolves.toEqual({
      invitationId: 'inv-1',
      emailSent: true,
    })

    expect(inviteMember).toHaveBeenCalledWith({
      invitationId: 'inv-1',
      organizationId: ORG,
      email: 'admin@riviera.example',
      role: 'owner',
      inviterId: 'user-operator',
      propertyIds: [],
      now: NOW,
      expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
      event: expect.objectContaining({
        _tag: 'identity.member.invited',
        organizationId: ORG,
        role: 'AccountAdmin',
        userId: 'user-operator',
        invitationId: 'inv-1',
        occurredAt: NOW,
      }),
    })
  })

  it('mails the invitation naming the Organization and the operator', async () => {
    const { invite, sent } = setup()

    await invite(INPUT, OPERATOR)

    expect(sent).toEqual([
      {
        email: 'admin@riviera.example',
        invitedByUsername: 'Bo',
        organizationName: 'Hotel Riviera',
        inviteLink: 'https://app.example.test/accept-invitation?id=inv-1',
        role: 'AccountAdmin',
        propertyNames: [],
        expiresInDays: 7,
      },
    ])
  })

  it('signs as the Reputation Key team when the operator has no name', async () => {
    const { invite, sent } = setup()

    await invite(INPUT, { ...OPERATOR, name: '  ' })

    expect(sent[0]?.invitedByUsername).toBe('The Reputation Key team')
  })

  it('logs the invitation by identifiers only', async () => {
    const { invite, logger } = setup()

    await invite(INPUT, OPERATOR)

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'platform.admin_invited',
        operatorUserId: 'user-operator',
        organizationId: ORG,
        invitationId: 'inv-1',
      },
      expect.any(String),
    )
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('admin@riviera')
  })

  it('keeps the invitation and reports emailSent false when the email fails', async () => {
    const { invite, sendEmail, logger } = setup()
    sendEmail.mockRejectedValueOnce(new Error('smtp down for admin@riviera.example'))

    await expect(invite(INPUT, OPERATOR)).resolves.toEqual({
      invitationId: 'inv-1',
      emailSent: false,
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('admin@riviera')
  })

  it.each([
    ['an Organization that does not exist', null, 'forbidden'],
    [
      'an Organization that already has an AccountAdmin',
      { ...ownerless, accountAdminCount: 1 },
      'forbidden',
    ],
    [
      'an Organization that is closing',
      { ...ownerless, lifecycleState: 'closing' as const },
      'forbidden',
    ],
  ])('refuses %s before inviting anyone', async (_label, administration, code) => {
    const { invite, inviteMember, sendEmail } = setup(administration)

    await expect(invite(INPUT, OPERATOR)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code,
    })
    expect(inviteMember).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when the command store refuses the address', async () => {
    const { invite, inviteMember, sendEmail } = setup()
    const conflict = Object.assign(new Error('another Organization'), {
      _tag: 'IdentityError',
      code: 'organization_conflict',
    })
    inviteMember.mockRejectedValueOnce(conflict)

    await expect(invite(INPUT, OPERATOR)).rejects.toBe(conflict)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
