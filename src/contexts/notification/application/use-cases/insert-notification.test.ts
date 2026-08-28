import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertNotification, type InsertNotificationDeps } from './insert-notification'
import { buildFakeInsertNotificationDeps } from './test-fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { Notification, NotificationPreference } from '../../domain/types'

const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const USER_ID = userId('user-1')
const NOW = new Date('2026-06-10T10:00:00.000Z')
const input = {
  userId: USER_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  type: 'review.created' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  eventId: 'event-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google' as const },
}

function preference(
  channel: 'in_app' | 'email',
  enabled: boolean,
  cadence: 'immediate' | 'daily' = 'daily',
): NotificationPreference {
  return {
    id: 'pref-1' as NotificationPreference['id'],
    userId: USER_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    category: 'workflow_collaboration',
    channel,
    enabled,
    cadence,
    urgentBypassEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('insertNotification', () => {
  let deps: InsertNotificationDeps

  beforeEach(() => {
    deps = buildFakeInsertNotificationDeps()
  })

  it('persists a property-scoped in-app notification with governed category', async () => {
    const result = await insertNotification(deps)(input)

    expect(result).toMatchObject({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
    })
    expect(deps.notificationRepo.insert).toHaveBeenCalledOnce()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('always persists Organization mandatory in-app and immediate email delivery', async () => {
    const mandatoryInput = {
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: null,
      type: 'account.organization_role_changed' as const,
      resourceType: 'organization' as const,
      resourceId: ORG_ID,
      eventId: 'identity-role-event-1',
    }

    const result = await insertNotification(deps)(mandatoryInput)

    expect(deps.preferenceRepo.findForDelivery).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      propertyId: null,
      category: 'mandatory',
      type: 'account.organization_role_changed',
    })
    expect(deps.emailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: null,
        category: 'mandatory',
        cadence: 'immediate',
        status: 'pending',
      }),
    )
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: 'email-1',
      organizationId: 'org-1',
    })
  })

  it('renders copy from the payload instead of storing caller-supplied text', async () => {
    const result = await insertNotification(deps)(input)

    // The handler passed facts only; the stored snapshot is the rendered copy.
    expect(result).toMatchObject({
      title: 'New review at Riverside Hotel',
      payload: { propertyName: 'Riverside Hotel', platform: 'google' },
      coalescedCount: 1,
      coalescedLatestAt: null,
    })
    expect(result?.body).toContain('Open it to read the review and reply')
  })

  it('drops payload keys that are not on the ADR 0046 r.8 allowlist', async () => {
    const result = await insertNotification(deps)({
      ...input,
      payload: {
        propertyName: 'Riverside Hotel',
        reviewText: 'The room smelled of smoke',
        reviewerName: 'Jane G.',
      },
    })

    expect(result?.payload).toEqual({ propertyName: 'Riverside Hotel' })
    expect(JSON.stringify(result)).not.toContain('smoke')
    expect(JSON.stringify(result)).not.toContain('Jane')
  })

  // The email-only preference arrange (findForDelivery answering per channel)
  // repeats in three tests because each asserts a different subject: the durable
  // email row plus immediate enqueue here, no second email on a coalesced repeat
  // (below), and a still-pending row when queue dispatch fails (further below).
  // Lifting it into a beforeEach would make "email is the only enabled channel"
  // non-local, and that premise is exactly what each of these tests is about.
  // Revisit if findForDelivery's signature changes and all three need one edit.
  // fallow-ignore-next-line code-duplication
  it('creates a durable property-scoped email row when the email preference is enabled', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference('email', true, 'immediate') : null,
    )

    await insertNotification(deps)(input)

    expect(deps.emailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        category: 'workflow_collaboration',
        cadence: 'immediate',
        idempotencyKey: 'notif-1:email',
        status: 'pending',
      }),
    )
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: 'email-1',
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
    })
  })

  it('skips every channel when concrete property preferences disable both', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        preference(channel, false),
    )

    await expect(insertNotification(deps)(input)).resolves.toBeNull()
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('deduplicates only within the concrete property scope', async () => {
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      await insertNotification(buildFakeInsertNotificationDeps())(input),
    )

    await insertNotification(deps)(input)

    expect(deps.notificationRepo.findUnreadByUserTypeResource).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID,
      PROPERTY_ID,
      'review.created',
      'item-1',
    )
  })

  // ── ADR 0046 r.2 ────────────────────────────────────────────────────

  // Each coalescing test arranges its own "existing unread row" by running the
  // use case against a second, independent deps set and feeding the result back
  // through findUnreadByUserTypeResource. That the prior row was produced by the
  // same code path is what makes the coalesce assertions meaningful, so a shared
  // helper or beforeEach would hide the load-bearing part of the premise and
  // couple these tests to whichever one is edited next. Revisit if building the
  // existing row ever needs more than these three lines.
  // fallow-ignore-next-line code-duplication
  it('bumps the existing unread row instead of inserting a second one', async () => {
    const existing = (await insertNotification(buildFakeInsertNotificationDeps())(
      input,
    )) as Notification
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(existing)

    const result = await insertNotification(deps)({
      ...input,
      eventId: 'event-2',
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        waitingHours: 5,
      },
    })

    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
    expect(deps.notificationRepo.refreshUnread).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      id: existing.id,
      coalescedCount: 2,
      coalescedLatestAt: NOW,
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        waitingHours: 5,
        occurrences: 2,
      },
    })
    // The bumped row is what gets persisted, verbatim.
    expect(deps.notificationRepo.refreshUnread).toHaveBeenCalledWith(result)
  })

  it('re-renders the coalesced copy so a repeat row does not read like a first one', async () => {
    const existing = (await insertNotification(buildFakeInsertNotificationDeps())(
      input,
    )) as Notification
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(existing)

    const result = await insertNotification(deps)(input)

    expect(result?.body).toContain('Updated 2 times')
  })

  it('keeps a payload key the repeat event could not resolve', async () => {
    const existing = (await insertNotification(buildFakeInsertNotificationDeps())(
      input,
    )) as Notification
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(existing)

    // The second event's lookup failed, so it carries no property name.
    const result = await insertNotification(deps)({
      ...input,
      payload: { platform: 'google' },
    })

    expect(result?.payload.propertyName).toBe('Riverside Hotel')
  })

  // Shares the email-only preference arrange described above line 91; here it is
  // combined with a pre-seeded unread row because the subject is "a coalesced
  // repeat sends no second email". Both arranges have to stay visible next to the
  // assertion: with either one hidden, a reader cannot tell whether emailRepo
  // stayed untouched because email is disabled or because the row coalesced.
  // Revisit only together with the group above line 91.
  // fallow-ignore-next-line code-duplication
  it('bumps only the in-app row: a repeat sends no second email', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference('email', true, 'immediate') : null,
    )
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      await insertNotification(buildFakeInsertNotificationDeps())(input),
    )

    await insertNotification(deps)(input)

    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  // ── goal.completed regression ───────────────────────────────────────

  it('persists goal.completed for a tenant with no preference rows', async () => {
    // Regression: `goal.completed` classified as `digest_summary`, whose default
    // policy was {in_app:false, email:false}, so this returned null and NOTHING
    // was written for a default tenant.
    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: 'goal-1',
      eventId: 'event-goal-1',
      payload: { goalName: 'Weekend response time' },
    })

    expect(deps.preferenceRepo.findForDelivery).toHaveBeenCalled()
    expect(deps.notificationRepo.insert).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      category: 'recognition',
      title: 'Goal completed: Weekend response time',
    })
  })

  it('defaults Action Required email to immediate while respecting quiet hours', async () => {
    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'portal.health_attention',
      resourceType: 'portal',
      resourceId: 'portal-1',
      eventId: 'event-portal-health-1',
      payload: {},
    })

    expect(result).toMatchObject({
      category: 'urgent_operational',
      priority: 'normal',
    })
    expect(deps.emailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ cadence: 'immediate' }),
    )
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledOnce()
  })

  it('keeps the durable email row pending when immediate queue dispatch is unavailable', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference('email', true, 'immediate') : null,
    )
    ;(deps.enqueueImmediateEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('queue unavailable'),
    )

    await expect(insertNotification(deps)(input)).resolves.not.toBeNull()
    expect(deps.emailRepo.insert).toHaveBeenCalledOnce()
  })
})
