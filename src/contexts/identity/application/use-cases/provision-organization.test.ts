import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import { identityError } from '../../domain/errors'
import type { InvitationEmail } from '../ports/invitation-email.port'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import type { PlatformOperatorActor } from '../dto/platform-console.dto'
import { provisionOrganization } from './provision-organization'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const OPERATOR: PlatformOperatorActor = { userId: userId('user-operator'), name: 'Bo' }

function setup() {
  const store = {
    listOrganizations: vi.fn(),
    readAdministration: vi.fn(),
    provisionOrganization: vi.fn(async () => {}),
  } satisfies PlatformOrganizationStore
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
  const provision = provisionOrganization({
    store,
    clock: () => NOW,
    newOrganizationId: () => organizationId('org-new'),
    newInvitationId: () => invitationId('inv-first'),
    invitationExpiresInMs: SEVEN_DAYS_MS,
    sendEmail,
    baseUrl: 'https://app.example.test',
    logger,
  })
  return { provision, store, sendEmail, sent, logger }
}

describe('provisionOrganization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the Organization and its first AccountAdmin invitation in one store call', async () => {
    const { provision, store } = setup()

    await expect(
      provision(
        { name: 'Hotel Riviera & Spa', adminEmail: 'admin@riviera.example' },
        OPERATOR,
      ),
    ).resolves.toEqual({
      organizationId: 'org-new',
      slug: 'hotel-riviera-spa',
      invitationId: 'inv-first',
      emailSent: true,
    })

    expect(store.provisionOrganization).toHaveBeenCalledOnce()
    expect(store.provisionOrganization).toHaveBeenCalledWith({
      organizationId: 'org-new',
      name: 'Hotel Riviera & Spa',
      slug: 'hotel-riviera-spa',
      now: NOW,
      firstAdmin: {
        invitationId: 'inv-first',
        organizationId: 'org-new',
        email: 'admin@riviera.example',
        role: 'owner',
        inviterId: 'user-operator',
        propertyIds: [],
        now: NOW,
        expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
        event: expect.objectContaining({
          _tag: 'identity.member.invited',
          organizationId: 'org-new',
          role: 'AccountAdmin',
          userId: 'user-operator',
          invitationId: 'inv-first',
        }),
      },
    })
  })

  it('keeps an explicit slug', async () => {
    const { provision, store } = setup()

    await provision(
      { name: 'Hotel Riviera', slug: 'riviera-hq', adminEmail: 'admin@riviera.example' },
      OPERATOR,
    )

    expect(store.provisionOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'riviera-hq' }),
    )
  })

  it('mails the first admin naming the new Organization', async () => {
    const { provision, sent } = setup()

    await provision(
      { name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' },
      OPERATOR,
    )

    expect(sent).toEqual([
      expect.objectContaining({
        email: 'admin@riviera.example',
        organizationName: 'Hotel Riviera',
        invitedByUsername: 'Bo',
        role: 'AccountAdmin',
        propertyNames: [],
        inviteLink: 'https://app.example.test/accept-invitation?id=inv-first',
      }),
    ])
  })

  it('logs the provisioning content-free: no identifiers, no address', async () => {
    const { provision, logger } = setup()

    await provision(
      { name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' },
      OPERATOR,
    )

    expect(logger.info).toHaveBeenCalledWith(
      { event: 'platform.organization_provisioned' },
      expect.any(String),
    )
    const logged = JSON.stringify(logger.info.mock.calls)
    expect(logged).not.toMatch(/user-operator|org-new|inv-first|@riviera/)
  })

  it('refuses a name whose derived slug is too short before writing anything', async () => {
    const { provision, store } = setup()

    await expect(
      provision({ name: 'A!', adminEmail: 'admin@riviera.example' }, OPERATOR),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'invalid_slug' })
    expect(store.provisionOrganization).not.toHaveBeenCalled()
  })

  it('reports a committed Organization with emailSent false when the email fails', async () => {
    const { provision, sendEmail } = setup()
    sendEmail.mockRejectedValueOnce(new Error('smtp down'))

    await expect(
      provision({ name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' }, OPERATOR),
    ).resolves.toMatchObject({ organizationId: 'org-new', emailSent: false })
  })

  it('creates nothing and sends nothing when the store refuses the invitation', async () => {
    const { provision, store, sendEmail } = setup()
    store.provisionOrganization.mockRejectedValueOnce(
      identityError(
        'organization_conflict',
        'This account already belongs to another Organization',
      ),
    )

    await expect(
      provision(
        { name: 'Hotel Riviera', adminEmail: 'taken@elsewhere.example' },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ code: 'organization_conflict' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
