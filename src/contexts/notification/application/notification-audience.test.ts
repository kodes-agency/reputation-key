import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationAudienceAuthorizer,
  type NotificationAudienceAuthorizationInput,
} from './notification-audience'
import {
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const PORTAL = portalId('22222222-2222-4222-8222-222222222222')
const RECIPIENT = userId('manager-1')
const INBOX_ITEM = inboxItemId('33333333-3333-4333-8333-333333333333')

const buildDeps = () => ({
  userLookup: {
    findByRole: vi.fn().mockResolvedValue([]),
  },
  responsibleManagers: {
    findForProperty: vi.fn().mockResolvedValue([]),
    findForPortal: vi.fn().mockResolvedValue([]),
    findForPortalGroup: vi.fn().mockResolvedValue([]),
    isEligibleForProperty: vi.fn().mockResolvedValue(false),
  },
  inboxItemLookup: {
    findInboxItemFacts: vi.fn().mockResolvedValue(null),
  },
})

const authorize = (overrides: Partial<NotificationAudienceAuthorizationInput> = {}) => ({
  userId: RECIPIENT,
  organizationId: ORG,
  propertyId: PROPERTY,
  audience: { kind: 'account_admin' as const },
  ...overrides,
})

describe('notification audience authorization', () => {
  it('authorizes only a current manager for an explicitly owned scope', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    deps.userLookup.findByRole.mockResolvedValue([userId('admin-1')])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'portal', portalId: PORTAL },
          },
        }),
      ),
    ).resolves.toBe(true)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('authorizes a current AccountAdmin only when an owned scope has no eligible manager', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: PROPERTY },
          },
        }),
      ),
    ).resolves.toBe(true)
  })

  it('does not treat an AccountAdmin as fallback while a scoped manager exists', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([userId('other-manager')])
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: PROPERTY },
          },
        }),
      ),
    ).resolves.toBe(false)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('revalidates direct AccountAdmin recovery recipients', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(createNotificationAudienceAuthorizer(deps)(authorize())).resolves.toBe(
      true,
    )
  })

  it('revalidates a direct assignee or reply author against property eligibility', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience: { kind: 'property_operator' } }),
      ),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('rejects a replaced Inbox assignee even when the old assignee remains property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: null,
      assignedTo: userId('replacement-manager'),
      propertyName: 'Riverside Hotel',
      rating: 2,
      sourceType: 'review',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM },
        }),
      ),
    ).resolves.toBe(false)
  })

  it('authorizes the current Inbox assignee only while they remain property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: null,
      assignedTo: RECIPIENT,
      propertyName: 'Riverside Hotel',
      rating: 2,
      sourceType: 'review',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM },
        }),
      ),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })
})
