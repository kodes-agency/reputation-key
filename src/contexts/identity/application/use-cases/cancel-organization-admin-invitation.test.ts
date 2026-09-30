import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import type {
  OrganizationAdministration,
  PlatformOrganizationStore,
} from '../ports/platform-organization-store.port'
import type { PlatformOperatorActor } from '../dto/platform-console.dto'
import { cancelOrganizationAdminInvitation } from './cancel-organization-admin-invitation'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const OPERATOR: PlatformOperatorActor = { userId: userId('user-operator'), name: 'Bo' }

const ownerless: OrganizationAdministration = {
  organizationId: organizationId('org-new'),
  name: 'Hotel Riviera',
  lifecycleState: 'active',
  accountAdminCount: 0,
  openAdminInvitationIds: [invitationId('inv-open')],
}

function setup(administration: OrganizationAdministration | null = ownerless) {
  const store = {
    listOrganizations: vi.fn(),
    readAdministration: vi.fn(async () => administration),
    provisionOrganization: vi.fn(),
  } satisfies PlatformOrganizationStore
  const cancelInvitation = vi.fn(async () => {})
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  const cancel = cancelOrganizationAdminInvitation({
    store,
    commandStore: { cancelInvitation },
    clock: () => NOW,
    logger,
  })
  return { cancel, store, cancelInvitation, logger }
}

const INPUT = { organizationId: 'org-new', invitationId: 'inv-open' }

describe('cancelOrganizationAdminInvitation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cancels through the ordinary command, scoped by the given Organization', async () => {
    const { cancel, store, cancelInvitation } = setup()

    await expect(cancel(INPUT, OPERATOR)).resolves.toBeUndefined()

    expect(store.readAdministration).toHaveBeenCalledWith('org-new')
    expect(cancelInvitation).toHaveBeenCalledWith({
      invitationId: 'inv-open',
      organizationId: 'org-new',
      event: expect.objectContaining({
        _tag: 'identity.invitation.canceled',
        invitationId: 'inv-open',
        organizationId: 'org-new',
        occurredAt: NOW,
      }),
    })
  })

  it('still cancels on an ownerless Organization that is no longer active', async () => {
    const { cancel, cancelInvitation } = setup({
      ...ownerless,
      lifecycleState: 'closure_requested',
    })

    await cancel(INPUT, OPERATOR)

    expect(cancelInvitation).toHaveBeenCalledOnce()
  })

  it('logs the cancellation by identifiers only', async () => {
    const { cancel, logger } = setup()

    await cancel(INPUT, OPERATOR)

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'platform.admin_invitation_canceled',
        operatorUserId: 'user-operator',
        organizationId: 'org-new',
        invitationId: 'inv-open',
      },
      expect.any(String),
    )
  })

  it.each([
    [
      'an invitation outside the open AccountAdmin invitations',
      { ...INPUT, invitationId: 'inv-member' },
      ownerless,
      'invitation_not_found',
    ],
    [
      'an Organization whose own AccountAdmin now manages invitations',
      INPUT,
      { ...ownerless, accountAdminCount: 1 },
      'forbidden',
    ],
    ['an Organization that does not exist', INPUT, null, 'forbidden'],
  ])('refuses %s', async (_label, input, administration, code) => {
    const { cancel, cancelInvitation } = setup(administration)

    await expect(cancel(input, OPERATOR)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code,
    })
    expect(cancelInvitation).not.toHaveBeenCalled()
  })
})
