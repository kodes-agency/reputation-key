import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  properties,
} from '#/shared/db/schema'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationCategory } from '../../domain/notification-types'
import { SETTLED_EMAIL_REASON } from '../../domain/notification-actionable'
import {
  insertNotification,
  mandatoryRepeatEmailKey,
  type InsertNotificationDeps,
} from './insert-notification'
import { buildInsertNotificationDeps } from './test-fixtures'

const ORG_ID = organizationId('org-insert-notification')
const PROPERTY_ID = propertyId('86100000-0000-4000-8000-000000000001')
const USER_ID = userId('user-insert-notification')
const input = {
  userId: USER_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  // A workflow notice: on in the app by default. An arrival (a new review) is
  // off by default (D4), so it would test the skip, not the write.
  type: 'inbox_note.added' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  eventId: 'event-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google' as const },
}

type Channel = 'in_app' | 'email'
type StoredAnswer = Readonly<{
  category: NotificationCategory
  channel: Channel
  enabled: boolean
  cadence?: 'immediate' | 'daily'
  maxRating?: 1 | 2 | 3 | 4
}>

let held: HeldTransaction

const seed = async (...answers: ReadonlyArray<StoredAnswer>) => {
  await held.db.insert(notificationPreferences).values(
    answers.map((answer) => ({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      category: answer.category,
      channel: answer.channel,
      enabled: answer.enabled,
      cadence: answer.cadence ?? 'daily',
      maxRating: answer.maxRating ?? null,
    })),
  )
}

/** The reader's Low ratings answers: how low each channel goes, and how it is sent. */
const lowRatings = (
  inApp: Readonly<{ enabled: boolean; maxRating: 1 | 2 | 3 | 4 }>,
  email: Readonly<{ enabled: boolean; maxRating: 1 | 2 | 3 | 4 }>,
): ReadonlyArray<StoredAnswer> => [
  { category: 'low_ratings', channel: 'in_app', cadence: 'immediate', ...inApp },
  { category: 'low_ratings', channel: 'email', cadence: 'immediate', ...email },
]

const noticeRows = () =>
  held.db.select().from(notifications).where(eq(notifications.organizationId, ORG_ID))
const emailRows = () =>
  held.db
    .select()
    .from(notificationEmailQueue)
    .where(eq(notificationEmailQueue.organizationId, ORG_ID))
const noticeById = async (id: string) =>
  (await held.db.select().from(notifications).where(eq(notifications.id, id)))[0]

describe.sequential('insertNotification (real PostgreSQL)', () => {
  let deps: InsertNotificationDeps

  beforeAll(async () => {
    held = await holdTransaction()
    await held.db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORG_ID,
      name: 'Insert Notification Property',
      slug: 'insert-notification',
      timezone: 'UTC',
    })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  beforeEach(async () => {
    await held.db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG_ID))
    await held.db.delete(notifications).where(eq(notifications.organizationId, ORG_ID))
    await held.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.organizationId, ORG_ID))
    deps = buildInsertNotificationDeps(held.db)
  })

  it('persists a property-scoped in-app notification with governed category', async () => {
    const result = await insertNotification(deps)(input)

    expect(result).toMatchObject({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
    })
    expect(await noticeRows()).toHaveLength(1)
    expect(await emailRows()).toHaveLength(0)
  })

  it('always persists Organization mandatory in-app and immediate email delivery', async () => {
    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: null,
      type: 'account.organization_role_changed' as const,
      resourceType: 'organization' as const,
      resourceId: ORG_ID,
      eventId: 'identity-role-event-1',
    })

    expect(result).toMatchObject({
      propertyId: null,
      category: 'mandatory',
      type: 'account.organization_role_changed',
    })
    const [email] = await emailRows()
    expect(email).toMatchObject({
      propertyId: null,
      category: 'mandatory',
      cadence: 'immediate',
      status: 'pending',
    })
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: email!.id,
      organizationId: ORG_ID,
    })
  })

  it('delivers a report outcome in-app only, with no Property preference to consult', async () => {
    // ADR 0059: Organization-scoped but not mandatory. ADR 0046's defaults
    // decide it — in-app on — and nothing can opt it into email. A Property's
    // switched-off answers for the same category are never consulted.
    await seed(
      { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
      { category: 'workflow_collaboration', channel: 'email', enabled: true },
    )

    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: null,
      type: 'beta_feedback.outcome' as const,
      resourceType: 'beta_feedback_report' as const,
      resourceId: '00000000-0000-4000-8000-0000000000f1',
      eventId: 'identity-beta-feedback-event-1',
      payload: { reportOutcome: 'resolved' as const },
    })

    expect(result).toMatchObject({
      propertyId: null,
      category: 'workflow_collaboration',
      type: 'beta_feedback.outcome',
      resourceType: 'beta_feedback_report',
    })
    expect(await noticeRows()).toHaveLength(1)
    expect(await emailRows()).toHaveLength(0)
    expect(deps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })

  it('renders copy from the payload instead of storing caller-supplied text', async () => {
    const result = await insertNotification(deps)(input)

    // The handler passed facts only; the stored snapshot is the rendered copy.
    expect(result).toMatchObject({
      title: 'New internal note on a review at Riverside Hotel',
      payload: { propertyName: 'Riverside Hotel', platform: 'google' },
      coalescedCount: 1,
      coalescedLatestAt: null,
    })
    expect(result?.body).toContain('Open it to read the thread')
    const [stored] = await noticeRows()
    expect(stored?.title).toBe('New internal note on a review at Riverside Hotel')
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
    const stored = JSON.stringify(await noticeRows())
    expect(JSON.stringify(result)).not.toContain('smoke')
    expect(JSON.stringify(result)).not.toContain('Jane')
    expect(stored).not.toContain('smoke')
    expect(stored).not.toContain('Jane')
  })

  it('creates a durable property-scoped email row when the email preference is enabled', async () => {
    await seed({
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })

    const result = await insertNotification(deps)(input)

    const [email] = await emailRows()
    expect(email).toMatchObject({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
      cadence: 'immediate',
      idempotencyKey: `${result!.id}:email`,
      status: 'pending',
    })
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: email!.id,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
    })
  })

  it('queues the email with the audience that admitted its recipient', async () => {
    // Send time rechecks that the recipient still holds this standing.
    const audience = {
      kind: 'responsible_scope' as const,
      scope: { kind: 'property' as const, propertyId: PROPERTY_ID },
    }
    await seed({
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })

    await insertNotification(deps)(input, audience)

    const [email] = await emailRows()
    expect(email?.recipientAudience).toEqual(audience)
  })

  it('skips every channel when concrete property preferences disable both', async () => {
    await seed(
      { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
      { category: 'workflow_collaboration', channel: 'email', enabled: false },
    )

    await expect(insertNotification(deps)(input)).resolves.toBeNull()
    expect(await noticeRows()).toHaveLength(0)
    expect(await emailRows()).toHaveLength(0)
  })

  // ── ADR 0046 r.2 ────────────────────────────────────────────────────

  it('bumps the existing unread row instead of inserting a second one', async () => {
    const existing = (await insertNotification(deps)(input))!

    const result = await insertNotification(deps)({
      ...input,
      eventId: 'event-2',
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        waitingHours: 5,
      },
    })

    expect(await noticeRows()).toHaveLength(1)
    expect(result).toMatchObject({
      id: existing.id,
      coalescedCount: 2,
      coalescedLatestAt: new Date('2026-06-10T10:00:00Z'),
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        waitingHours: 5,
        occurrences: 2,
      },
    })
  })

  it('re-renders the coalesced copy so a repeat row does not read like a first one', async () => {
    await insertNotification(deps)(input)

    const result = await insertNotification(deps)(input)

    expect(result?.body).toMatch(/ 2 notes added\.$/)
  })

  it('keeps a payload key the repeat event could not resolve', async () => {
    await insertNotification(deps)(input)

    // The second event's lookup failed, so it carries no property name.
    const result = await insertNotification(deps)({
      ...input,
      payload: { platform: 'google' },
    })

    expect(result?.payload.propertyName).toBe('Riverside Hotel')
  })

  it('bumps only the in-app row: a repeat sends no second email', async () => {
    await seed({
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })
    await insertNotification(deps)(input)
    expect(await emailRows()).toHaveLength(1)

    await insertNotification(deps)({ ...input, eventId: 'event-2' })

    expect(await emailRows()).toHaveLength(1)
    expect(await noticeRows()).toHaveLength(1)
  })

  // ── Mandatory repeats (ADR 0046: mandatory notices always go by email) ──
  //
  // Every account notice keys on (organization, orgId), so a second role change
  // coalesces into the first one's unread row. The in-app row still coalesces;
  // the email must not: each mandatory event is mailed, anchored on that row
  // and keyed on the event, because the row's own `${id}:email` key would hand
  // back the first, already-sent email.

  const roleChange = (eventId: string) => ({
    userId: USER_ID,
    organizationId: ORG_ID,
    propertyId: null,
    type: 'account.organization_role_changed' as const,
    resourceType: 'organization' as const,
    resourceId: ORG_ID,
    eventId,
  })

  it('emails a repeat mandatory notice that coalesced into the unread row', async () => {
    const first = (await insertNotification(deps)(roleChange('identity-role-event-1')))!
    const repeatDeps = buildInsertNotificationDeps(held.db)

    const result = await insertNotification(repeatDeps)(
      roleChange('identity-role-event-2'),
    )

    expect(result).toMatchObject({ id: first.id, coalescedCount: 2 })
    const repeatEmail = (await emailRows()).filter(
      (email) =>
        email.idempotencyKey ===
        mandatoryRepeatEmailKey('identity-role-event-2', USER_ID),
    )
    expect(repeatEmail).toHaveLength(1)
    expect(repeatEmail[0]).toMatchObject({
      notificationId: first.id,
      propertyId: null,
      category: 'mandatory',
      cadence: 'immediate',
    })
    expect(repeatDeps.enqueueImmediateEmail).toHaveBeenCalledOnce()
    expect(repeatDeps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: repeatEmail[0]!.id,
      organizationId: ORG_ID,
    })
  })

  it('emails a mandatory repeat the database folded into a raced unread row', async () => {
    // Whichever event created the unread row, the other is folded into it by
    // the writer's upsert and is mailed under its own event's key.
    const raced = (await insertNotification(deps)(roleChange('identity-role-event-2')))!

    await insertNotification(deps)(roleChange('identity-role-event-1'))

    const emails = await emailRows()
    expect(emails).toHaveLength(2)
    expect(emails).toContainEqual(
      expect.objectContaining({
        notificationId: raced.id,
        idempotencyKey: mandatoryRepeatEmailKey('identity-role-event-1', USER_ID),
      }),
    )
  })

  it('sends no second email when a mandatory event is replayed into its own row', async () => {
    await insertNotification(deps)(roleChange('identity-role-event-1'))
    const replayDeps = buildInsertNotificationDeps(held.db)

    await insertNotification(replayDeps)(roleChange('identity-role-event-1'))

    expect(await emailRows()).toHaveLength(1)
    expect(replayDeps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })

  it('stores an email-only anchor already read, so it never holds the unread key', async () => {
    // With in-app off the row is only the email's anchor. Stored unread (and
    // hidden), it held ADR 0046 r.2's unread (user, type, resource) key, the
    // database folded every later event into it, and no later email went out.
    await seed(
      { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
      {
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        cadence: 'immediate',
      },
    )

    await expect(insertNotification(deps)(input)).resolves.toBeNull()

    const [anchor] = await noticeRows()
    expect(anchor).toMatchObject({ status: 'read', readAt: null })
    expect(await emailRows()).toHaveLength(1)

    await insertNotification(deps)({ ...input, eventId: 'event-2' })
    expect(await noticeRows()).toHaveLength(2)
    expect(await emailRows()).toHaveLength(2)
  })

  // ── goal.completed regression ───────────────────────────────────────

  it('persists goal.completed for a tenant with no preference rows', async () => {
    // Regression: `goal.completed` classified as `digest_summary`, whose default
    // policy was {in_app:false, email:false}, so this returned null and NOTHING
    // was written for a default tenant.
    const goal = {
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'goal.completed' as const,
      resourceType: 'goal' as const,
      resourceId: 'goal-1',
      eventId: 'event-goal-1',
      payload: {
        propertyName: 'Seaview Hotel',
        goalName: 'Monthly portal goal',
        goalMonth: '2026-11',
        goalSubjectKind: 'property' as const,
        goalOutcome: 'met' as const,
        goalMeasure: 'portal_rating_count' as const,
        goalCount: 41,
        goalTargetCount: 40,
      },
    }

    const result = await insertNotification(deps)(goal)

    // The frozen snapshot is the approved copy (P-8), figures included.
    expect(result).toMatchObject({
      category: 'portal_goals',
      title: 'Seaview Hotel met its November portal goal',
      body: 'Your portals brought in 41 private ratings. The goal was 40.',
    })
    expect(await noticeRows()).toHaveLength(1)

    // Asked under Portal goals, the row migration 0063 copied every "Goals"
    // answer into (ADR 0046, amended 2026-10-17).
    await seed({ category: 'portal_goals', channel: 'in_app', enabled: false })
    await expect(
      insertNotification(deps)({
        ...goal,
        resourceId: 'goal-2',
        eventId: 'event-goal-2',
      }),
    ).resolves.toBeNull()
  })

  // Goal email is daily only (ADR 0046, amended 2026-09-22), but a row saved
  // before that may still say immediate. Delivery must not honour it.
  it('queues goal email for the daily digest even when a stored row says immediate', async () => {
    await seed({
      category: 'portal_goals',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })

    await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: 'goal-1',
      eventId: 'event-goal-1',
      payload: { goalName: 'Weekend response time' },
    })

    expect(await emailRows()).toEqual([
      expect.objectContaining({ category: 'portal_goals', cadence: 'daily' }),
    ])
    expect(deps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })

  // ── The Guest voice summary and the Urgent alert (ADR 0046, amended 2026-10-30) ──

  const summaryInput = {
    userId: USER_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    type: 'guest_voice.summary' as const,
    resourceType: 'property' as const,
    resourceId: `${PROPERTY_ID}:2026-11-09`,
    eventId: 'event-summary-1',
    payload: {
      propertyName: 'Seaview Hotel',
      guestVoiceKind: 'weekly' as const,
      guestVoiceWindow: '90d' as const,
      guestVoiceLines: [
        {
          kind: 'protect' as const,
          topic: 'staff_service' as const,
          reviewCount: 61,
          textReviewCount: 128,
        },
      ],
    },
  }

  it('persists nothing, and mails nothing, for a manager who never asked for the Monday email', async () => {
    const result = await insertNotification(deps)(summaryInput)

    expect(result).toBeNull()
    expect(await noticeRows()).toHaveLength(0)
    expect(await emailRows()).toHaveLength(0)
  })

  it('mails the Monday email at once, as a message of its own, to a manager who turned email on', async () => {
    await seed({
      category: 'guest_voice',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })

    const result = await insertNotification(deps)(summaryInput)

    // Email only: nothing is returned for the app, and the row the queue anchors on is
    // stored already read, so it never holds the unread key.
    expect(result).toBeNull()
    expect(await noticeRows()).toEqual([
      expect.objectContaining({ category: 'guest_voice', status: 'read', readAt: null }),
    ])
    expect(await emailRows()).toEqual([
      expect.objectContaining({
        category: 'guest_voice',
        cadence: 'immediate',
        priority: 'normal',
      }),
    ])
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledOnce()
  })

  it('never folds the Monday email into the daily digest, even from a stored row that says daily', async () => {
    await seed({
      category: 'guest_voice',
      channel: 'email',
      enabled: true,
      cadence: 'daily',
    })

    await insertNotification(deps)(summaryInput)

    expect(await emailRows()).toEqual([
      expect.objectContaining({ category: 'guest_voice', cadence: 'immediate' }),
    ])
  })

  it('shows the Monday row in the app only for a manager who turned the app on', async () => {
    await seed({ category: 'guest_voice', channel: 'in_app', enabled: true })

    const result = await insertNotification(deps)(summaryInput)

    expect(result).toMatchObject({ category: 'guest_voice', status: 'unread' })
    expect(await emailRows()).toHaveLength(0)
  })

  it('files the Urgent alert under Action needed, urgent, and mails it at once by default', async () => {
    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'review.ai_urgent_detected',
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      eventId: 'event-urgent-1',
      payload: { propertyName: 'Seaview Hotel', platform: 'google' },
    })

    // The existing urgent channel and the reader's existing preferences, nothing new.
    expect(result).toMatchObject({
      category: 'urgent_operational',
      priority: 'urgent',
      title: 'An urgent review needs you at Seaview Hotel',
    })
    expect(await emailRows()).toEqual([
      expect.objectContaining({
        category: 'urgent_operational',
        cadence: 'immediate',
        priority: 'urgent',
      }),
    ])
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledOnce()
  })

  it('mails the Urgent alert to nobody who switched urgent email off, and still shows it in the app', async () => {
    await seed({
      category: 'urgent_operational',
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
    })

    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      type: 'review.ai_urgent_detected',
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      eventId: 'event-urgent-2',
      payload: { propertyName: 'Seaview Hotel' },
    })

    expect(result).toMatchObject({ category: 'urgent_operational', status: 'unread' })
    expect(await emailRows()).toHaveLength(0)
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
    expect(await emailRows()).toEqual([expect.objectContaining({ cadence: 'immediate' })])
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledOnce()
  })

  it('keeps the durable email row pending when immediate queue dispatch is unavailable', async () => {
    await seed({
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
    })
    vi.mocked(deps.enqueueImmediateEmail!).mockRejectedValueOnce(
      new Error('queue unavailable'),
    )

    await expect(insertNotification(deps)(input)).resolves.not.toBeNull()
    expect(await emailRows()).toEqual([expect.objectContaining({ status: 'pending' })])
  })

  // D3: one row for one piece of work, per reader.
  describe("a notice that takes over its reader's earlier ones", () => {
    const assigned = { ...input, type: 'inbox.assigned' as const, eventId: 'assign-1' }
    const arrival = { ...input, type: 'review.created' as const, eventId: 'review-1' }

    /** The reader's own arrival row about the item, with its email still queued. */
    const arrivalWithQueuedEmail = async () => {
      await seed(
        { category: 'arrivals', channel: 'in_app', enabled: true },
        { category: 'arrivals', channel: 'email', enabled: true },
      )
      const row = (await insertNotification(deps)(arrival))!
      expect(await emailRows()).toEqual([expect.objectContaining({ status: 'pending' })])
      return row
    }

    it("retires the assignee's arrival row in the app, and keeps its email when the assignment sends none", async () => {
      const row = await arrivalWithQueuedEmail()

      await insertNotification(deps)(assigned)

      expect((await noticeById(row.id))?.resolvedAt).toEqual(expect.any(Date))
      // Workflow email is off by default: the arrival's email is the reader's
      // only email about the item.
      expect(await emailRows()).toEqual([expect.objectContaining({ status: 'pending' })])
    })

    it("cancels the arrival's queued email when the assignment sends one of its own", async () => {
      const row = await arrivalWithQueuedEmail()
      await seed(
        { category: 'workflow_collaboration', channel: 'in_app', enabled: true },
        { category: 'workflow_collaboration', channel: 'email', enabled: true },
      )

      await insertNotification(deps)(assigned)

      const emails = await emailRows()
      expect(emails.find((email) => email.notificationId === row.id)).toMatchObject({
        status: 'cancelled',
        suppressionReason: 'work_settled',
      })
    })

    it('leaves the arrival standing when the assignment only goes by email', async () => {
      const row = await arrivalWithQueuedEmail()
      await seed(
        { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
        { category: 'workflow_collaboration', channel: 'email', enabled: true },
      )

      await insertNotification(deps)(assigned)

      expect((await noticeById(row.id))?.resolvedAt).toBeNull()
    })

    it('retires the previous holder\'s "Assigned to you" when the item moves on', async () => {
      const holding = (await insertNotification(deps)(assigned))!

      await insertNotification(deps)({
        ...input,
        type: 'inbox.unassigned',
        eventId: randomUUID(),
      })

      expect((await noticeById(holding.id))?.resolvedAt).toEqual(expect.any(Date))
    })

    it('takes over nothing for a notice that supersedes no other', async () => {
      const row = await arrivalWithQueuedEmail()

      await insertNotification(deps)(input)

      expect((await noticeById(row.id))?.resolvedAt).toBeNull()
    })
  })

  // D4: arrivals are off in the app by default; guest concerns are not arrivals.
  describe('an arrival', () => {
    const arrival = { ...input, type: 'review.created' as const, eventId: 'review-1' }
    const portalFeedback = (guestRating?: number) => ({
      ...arrival,
      type: 'feedback.created' as const,
      payload: {
        platform: 'portal' as const,
        ...(guestRating === undefined ? {} : { guestRating }),
      },
    })

    it('stores nothing for a new review while its reader has not turned arrivals on', async () => {
      await expect(insertNotification(deps)(arrival)).resolves.toBeNull()

      expect(await noticeRows()).toHaveLength(0)

      await seed({ category: 'arrivals', channel: 'in_app', enabled: true })
      await expect(insertNotification(deps)(arrival)).resolves.toMatchObject({
        category: 'arrivals',
      })
    })

    it('files four- and five-star private feedback as an arrival', async () => {
      await expect(insertNotification(deps)(portalFeedback(5))).resolves.toBeNull()
      await seed({ category: 'arrivals', channel: 'in_app', enabled: true })

      const result = await insertNotification(deps)(portalFeedback(5))

      expect(result).toMatchObject({ category: 'arrivals' })
    })

    it('keeps private feedback with no rating as Action needed, always in the app', async () => {
      const result = await insertNotification(deps)(portalFeedback())

      expect(result).toMatchObject({ category: 'urgent_operational' })
    })
  })

  // ADR 0046, amended 2026-09-30: how low is the reader's, per channel —
  // 3★ or lower in the app and 2★ or lower by email unless they chose.
  describe('a low rating', () => {
    const feedback = (guestRating: number) => ({
      ...input,
      type: 'feedback.created' as const,
      eventId: `feedback-${guestRating}`,
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'portal' as const,
        guestRating,
      },
    })
    const review = { ...input, type: 'review.created' as const, eventId: 'review-low' }
    const DEFAULT_THRESHOLDS = lowRatings(
      { enabled: true, maxRating: 3 },
      { enabled: true, maxRating: 2 },
    )
    const arrivalsInApp: StoredAnswer = {
      category: 'arrivals',
      channel: 'in_app',
      enabled: true,
    }

    it('files private feedback rated 1 as Low ratings, in the app and by email', async () => {
      const result = await insertNotification(deps)(feedback(1))

      expect(result).toMatchObject({
        category: 'low_ratings',
        title: 'Low-rated guest feedback at Riverside Hotel',
      })
      expect(result?.payload).toMatchObject({ lowRating: true, guestRating: 1 })
      expect(await emailRows()).toHaveLength(1)
    })

    it('tells about 3-star feedback in the app only, since email is 2 stars or lower by default', async () => {
      const result = await insertNotification(deps)(feedback(3))

      expect(result).toMatchObject({ category: 'low_ratings' })
      // Above the email threshold, the reader's New reviews answer stands:
      // off by default.
      expect(await emailRows()).toHaveLength(0)
    })

    it('files feedback above both thresholds as an arrival, off by default', async () => {
      await expect(insertNotification(deps)(feedback(4))).resolves.toBeNull()

      expect(await noticeRows()).toHaveLength(0)
    })

    it("routes a Google review by Review's eligible rating and keeps only the outcome", async () => {
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      const result = await insertNotification(deps)(review)

      expect(deps.ratingForRouting).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        inboxItemId: 'item-1',
      })
      expect(result).toMatchObject({
        category: 'low_ratings',
        title: 'Low-rated review at Riverside Hotel',
      })
      // The flag, never the stars: a Google rating stays in Review (ADR 0031).
      expect(result?.payload).toEqual({
        propertyName: 'Riverside Hotel',
        platform: 'google',
        lowRating: true,
      })
      expect((await noticeRows())[0]?.payload).toEqual(result?.payload)
      expect(JSON.stringify(await emailRows())).not.toContain('"rating"')
    })

    it('stores nothing for a Google review above both thresholds, like any new review', async () => {
      vi.mocked(deps.ratingForRouting).mockResolvedValue(4)

      await expect(insertNotification(deps)(review)).resolves.toBeNull()

      expect(await noticeRows()).toHaveLength(0)
    })

    it('routes a review whose rating Review no longer holds as a new review', async () => {
      // Past Google's cache window the eligible read answers null.
      vi.mocked(deps.ratingForRouting).mockResolvedValue(null)

      await expect(insertNotification(deps)(review)).resolves.toBeNull()

      expect(await noticeRows()).toHaveLength(0)
    })

    it("follows the reader's own thresholds: off in the app still mails a 1-star review", async () => {
      await seed(
        ...lowRatings({ enabled: false, maxRating: 3 }, { enabled: true, maxRating: 1 }),
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

      // Not shown in the app, so nothing comes back to display.
      await expect(insertNotification(deps)(review)).resolves.toBeNull()

      expect(await noticeRows()).toEqual([
        expect.objectContaining({
          category: 'low_ratings',
          status: 'read',
          readAt: null,
        }),
      ])
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'low_ratings', cadence: 'immediate' }),
      ])
    })

    // Each channel admits a rated notice under its own category, and the
    // later checks read exactly that one: the feed the row's, the pre-send
    // recheck and the unsubscribe link the email's.
    it('files the row as the arrival its reader shows, and mails it as a low rating', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 1 }, { enabled: true, maxRating: 3 }),
        arrivalsInApp,
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      const result = await insertNotification(deps)(review)

      expect(result).toMatchObject({ category: 'arrivals' })
      expect(result?.payload).not.toHaveProperty('lowRating')
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'low_ratings', cadence: 'immediate' }),
      ])
    })

    it('files the row as a low rating, and mails it under the New reviews answer', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 3 }, { enabled: true, maxRating: 1 }),
        { category: 'arrivals', channel: 'email', enabled: true, cadence: 'daily' },
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(3)

      const result = await insertNotification(deps)(review)

      expect(result).toMatchObject({ category: 'low_ratings' })
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'arrivals', cadence: 'daily' }),
      ])
    })

    describe('an edit to a review whose notice still waits', () => {
      const edit = (eventId: string) => ({
        ...review,
        type: 'review.updated' as const,
        eventId,
      })

      it("replaces the waiting row when the edit crosses the reader's threshold", async () => {
        // The first edit, to four stars, is an arrival the reader shows and
        // is mailed.
        await seed(...DEFAULT_THRESHOLDS, arrivalsInApp, {
          category: 'arrivals',
          channel: 'email',
          enabled: true,
          cadence: 'daily',
        })
        vi.mocked(deps.ratingForRouting).mockResolvedValue(4)
        const waiting = (await insertNotification(deps)(edit('edit-1')))!
        expect(waiting).toMatchObject({ category: 'arrivals' })
        expect(await emailRows()).toEqual([
          expect.objectContaining({ status: 'pending' }),
        ])
        vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

        const result = await insertNotification(deps)(edit('edit-2'))

        expect(result).toMatchObject({
          category: 'low_ratings',
          title: 'Review edited to a low rating at Riverside Hotel',
        })
        // Dismissed, not settled: the review still waits for a reply.
        expect(await noticeById(waiting.id)).toMatchObject({
          status: 'dismissed',
          resolvedAt: null,
        })
        const emails = await emailRows()
        expect(emails.find((email) => email.notificationId === waiting.id)).toMatchObject(
          {
            status: 'cancelled',
            suppressionReason: SETTLED_EMAIL_REASON,
          },
        )
        expect(await noticeRows()).toHaveLength(2)
      })

      it('folds an edit that stays on the same side of the threshold', async () => {
        vi.mocked(deps.ratingForRouting).mockResolvedValue(2)
        const waiting = (await insertNotification(deps)(edit('edit-1')))!
        vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

        const result = await insertNotification(deps)(edit('edit-2'))

        expect(result).toMatchObject({
          id: waiting.id,
          category: 'low_ratings',
          coalescedCount: 2,
        })
        expect(await noticeRows()).toEqual([
          expect.objectContaining({ id: waiting.id, status: 'unread' }),
        ])
      })
    })

    it('is not low for a reader whose thresholds are lower than the rating', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 1 }, { enabled: true, maxRating: 1 }),
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      await expect(insertNotification(deps)(review)).resolves.toBeNull()
    })

    it('does not look for a rating on a notice that has none', async () => {
      await insertNotification(deps)(input)

      expect(deps.ratingForRouting).not.toHaveBeenCalled()
    })
  })

  // ── Channel reads on a lent transaction ─────────────────────────────

  describe('channel reads on a lent transaction', () => {
    it.each(['inbox_note.added', 'feedback.created'] as const)(
      'resolves %s without overlapping preference reads',
      async (type) => {
        const query = held.client.query.bind(held.client) as (
          ...args: unknown[]
        ) => Promise<unknown>
        let active = 0
        let peak = 0
        let reads = 0
        const spy = vi.spyOn(held.client, 'query').mockImplementation(((
          ...args: unknown[]
        ) => {
          const first = args[0]
          const text =
            typeof first === 'string' ? first : ((first as { text?: string }).text ?? '')
          if (/notification_(preferences|category_defaults)/.test(text)) reads++
          active++
          peak = Math.max(peak, active)
          return query(...args).finally(() => {
            active--
          })
        }) as never)

        try {
          const notice = await insertNotification(deps)({
            ...input,
            type,
            payload: {
              propertyName: 'Hotel',
              platform: type === 'feedback.created' ? 'portal' : 'google',
              guestRating: 1,
            },
          })

          expect(notice).toMatchObject({
            category:
              type === 'feedback.created' ? 'low_ratings' : 'workflow_collaboration',
          })
        } finally {
          spy.mockRestore()
        }
        expect(reads).toBeGreaterThan(1)
        expect(peak).toBe(1)
      },
    )
  })

  // `integration.reauthorization_required` anchors on a Property so it can be
  // mailed. With no active Property to anchor on it falls back to the
  // Organization: in the bell, never by email, rather than to nobody.
  it('lands a Google reauthorization notice without a Property in the bell, with no email', async () => {
    await seed(
      { category: 'urgent_operational', channel: 'email', enabled: true },
      { category: 'urgent_operational', channel: 'in_app', enabled: true },
    )

    const result = await insertNotification(deps)({
      userId: USER_ID,
      organizationId: ORG_ID,
      propertyId: null,
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
      resourceId: '00000000-0000-4000-8000-0000000000e2',
      eventId: 'event-1',
      payload: { reauthorizationCause: 'provider_revoked' },
    })

    expect(result).toMatchObject({
      propertyId: null,
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
    })
    expect(
      await held.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, ORG_ID),
            eq(notifications.type, 'integration.reauthorization_required'),
          ),
        ),
    ).toHaveLength(1)
    expect(await emailRows()).toHaveLength(0)
    expect(deps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })
})
