import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  createNotificationRecipientStanding,
  createRecipientStandingMemo,
} from './notification-recipient-standing'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const MANAGER = userId('manager-1')
const OTHER = userId('manager-2')
const ADMIN = userId('admin-1')

const makeDeps = () => ({
  responsibleManagers: {
    findForProperty: vi.fn(async () => [MANAGER]),
    findForPortal: vi.fn(async () => [MANAGER]),
    findForPortalGroup: vi.fn(async () => [MANAGER]),
    isEligibleForProperty: vi.fn(
      async (_org: unknown, _property: unknown, _user: unknown) => true,
    ),
  },
  userLookup: {
    findByRole: vi.fn(async () => [ADMIN]),
  },
  replyApproval: {
    canApproveReplies: vi.fn(async () => true),
  },
})

const standingOf = (
  deps: ReturnType<typeof makeDeps>,
  audience: unknown,
  recipient = MANAGER,
) =>
  createNotificationRecipientStanding(deps)({
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: recipient,
    audience,
  })

describe('notification recipient standing at send time', () => {
  // I5.3: an approval request stands on two authorities, and the send must
  // recheck both — hours can pass before the mail leaves.
  it('requires both responsibility and reply.manage when the audience was an approver', async () => {
    const deps = makeDeps()
    const audience = { kind: 'reply_approver', propertyId: PROPERTY as string }

    await expect(standingOf(deps, audience)).resolves.toBe(true)

    deps.replyApproval.canApproveReplies.mockResolvedValue(false)
    await expect(standingOf(deps, audience)).resolves.toBe(false)

    deps.replyApproval.canApproveReplies.mockResolvedValue(true)
    deps.responsibleManagers.findForProperty.mockResolvedValue([])
    await expect(standingOf(deps, audience)).resolves.toBe(false)
  })

  it('refuses a recipient who left the Organization or lost access to the Property', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

    await expect(
      standingOf(deps, { kind: 'inbox_assignee', inboxItemId: 'item-1' }),
    ).resolves.toBe(false)
    await expect(standingOf(deps, null)).resolves.toBe(false)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      MANAGER,
    )
  })

  it('requires current responsibility when the audience was a responsible scope', async () => {
    const deps = makeDeps()
    const audience = {
      kind: 'responsible_scope',
      scope: { kind: 'portal', portalId: 'portal-1' },
    }

    await expect(standingOf(deps, audience)).resolves.toBe(true)
    deps.responsibleManagers.findForPortal.mockResolvedValue([OTHER])
    await expect(standingOf(deps, audience)).resolves.toBe(false)
  })

  it('requires responsibility for the Portal a health notice was about', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([OTHER])

    await expect(
      standingOf(deps, {
        kind: 'portal_health',
        portalId: 'portal-1',
        status: 'degraded',
        reason: 'google_destination_unavailable',
        effectiveFrom: '2026-09-21T06:00:00.000Z',
      }),
    ).resolves.toBe(false)
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, 'portal-1')
  })

  it('requires the AccountAdmin role when the audience was the account admins', async () => {
    const deps = makeDeps()

    await expect(standingOf(deps, { kind: 'account_admin' }, ADMIN)).resolves.toBe(true)
    deps.userLookup.findByRole.mockResolvedValue([])
    await expect(standingOf(deps, { kind: 'account_admin' }, ADMIN)).resolves.toBe(false)
  })

  it('asks only for Property eligibility when the audience names no standing duty', async () => {
    const deps = makeDeps()

    await expect(standingOf(deps, { kind: 'property_operator' })).resolves.toBe(true)
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('lets eligibility alone decide for a row queued before audiences were stored', async () => {
    await expect(standingOf(makeDeps(), null)).resolves.toBe(true)
  })

  it('fails closed on a stored audience it can no longer read', async () => {
    await expect(
      standingOf(makeDeps(), { kind: 'responsible_scope', scope: {} }),
    ).resolves.toBe(false)
  })

  describe('within one delivery pass', () => {
    const OTHER_PROPERTY = propertyId('22222222-2222-4222-8222-222222222222')
    const responsible = {
      kind: 'responsible_scope',
      scope: { kind: 'portal', portalId: 'portal-1' },
    }

    it('asks Property eligibility once per Property and each audience once', async () => {
      // A digest carries many rows per Property, each with its own work-item
      // audience; eligibility does not depend on the audience at all.
      const deps = makeDeps()
      const standing = createNotificationRecipientStanding(deps)
      const memo = createRecipientStandingMemo()
      const rows = [
        [PROPERTY, { kind: 'inbox_assignee', inboxItemId: 'item-1' }],
        [PROPERTY, { kind: 'inbox_assignee', inboxItemId: 'item-2' }],
        [PROPERTY, responsible],
        [OTHER_PROPERTY, responsible],
      ] as const

      for (const [property, audience] of rows) {
        await expect(
          standing(
            { organizationId: ORG, propertyId: property, userId: MANAGER, audience },
            memo,
          ),
        ).resolves.toBe(true)
      }

      expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledTimes(2)
      expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledTimes(1)
    })

    it('still refuses every row on a Property the recipient lost', async () => {
      const deps = makeDeps()
      deps.responsibleManagers.isEligibleForProperty.mockImplementation(
        async (_org, property) => property !== OTHER_PROPERTY,
      )
      const standing = createNotificationRecipientStanding(deps)
      const memo = createRecipientStandingMemo()
      const ask = (property: typeof PROPERTY) =>
        standing(
          {
            organizationId: ORG,
            propertyId: property,
            userId: MANAGER,
            audience: responsible,
          },
          memo,
        )

      await expect(ask(PROPERTY)).resolves.toBe(true)
      await expect(ask(OTHER_PROPERTY)).resolves.toBe(false)
    })
  })
})
