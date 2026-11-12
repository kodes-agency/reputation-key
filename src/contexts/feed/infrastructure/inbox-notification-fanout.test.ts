// Feed notification surface — shared fan-out for durable delivery and repair.
//
// These tests pin the recipient outcomes the outbox consumer writes notices for.

import { describe, it, expect, beforeEach } from 'vitest'
import { inboxItemCreatedNotices } from '../notify/inbox.server'
import {
  createNotificationConsumerDeps,
  type FakeNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import { unbrand } from '#/shared/domain/ids'

const input = (overrides: Record<string, unknown> = {}) => ({
  inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceType: 'review',
  ...overrides,
})

describe('inboxItemCreatedNotices', () => {
  let deps: FakeNotificationConsumerDeps

  beforeEach(() => {
    deps = createNotificationConsumerDeps()
  })

  it('returns one notice per recipient', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    const outcome = await inboxItemCreatedNotices(deps, input())

    expect(outcome.kind).toBe('notices')
    const notices = outcome.kind === 'notices' ? outcome.notices : []
    expect(notices.map((notice) => notice.userId)).toEqual([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])
    expect(notices[0]).toEqual(
      expect.objectContaining({
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
      }),
    )
    expect(deps.jobs).toHaveLength(0)
  })

  it('distinguishes the three reasons there are no notices', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await expect(
      inboxItemCreatedNotices(deps, input({ sourceType: 'goal' })),
    ).resolves.toEqual({ kind: 'skipped', reason: 'unknown_source' })

    await expect(
      inboxItemCreatedNotices(deps, input({ propertyId: null })),
    ).resolves.toEqual({ kind: 'skipped', reason: 'no_property' })

    deps.responsibleManagers.findForProperty.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([])
    await expect(inboxItemCreatedNotices(deps, input())).resolves.toEqual({
      kind: 'skipped',
      reason: 'no_recipients',
    })

    expect(deps.jobs).toHaveLength(0)
  })

  it('does not announce a review an import brought in as Google history', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
    deps.inboxItemLookup.isHistoricalOnboardingItem.mockResolvedValue(true)

    await expect(inboxItemCreatedNotices(deps, input())).resolves.toEqual({
      kind: 'skipped',
      reason: 'historical_onboarding',
    })

    expect(deps.jobs).toHaveLength(0)
    expect(deps.inboxItemLookup.isHistoricalOnboardingItem).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.inboxItemId,
      NOTIF_TEST_IDS.orgId,
    )
  })

  it('always announces private feedback: the history rule is for Google reviews only', async () => {
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: unbrand(NOTIF_TEST_IDS.propId),
      portalId: 'portal-1',
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    deps.responsibleManagers.findForPortal.mockResolvedValue([NOTIF_TEST_IDS.manager1])
    // Even a lookup that answered yes cannot silence a guest's feedback.
    deps.inboxItemLookup.isHistoricalOnboardingItem.mockResolvedValue(true)

    await expect(
      inboxItemCreatedNotices(deps, input({ sourceType: 'feedback' })),
    ).resolves.toEqual({
      kind: 'notices',
      notices: [expect.objectContaining({ type: 'feedback.created' })],
    })
  })
})
