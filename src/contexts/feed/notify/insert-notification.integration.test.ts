import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { notifications } from '#/shared/db/schema'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  insertNotification,
  mandatoryRepeatEmailKey,
  type InsertNotificationDeps,
  type InsertNotificationInput,
} from './insert-notification.server'
import {
  buildInsertNotificationDeps,
  useInsertNotificationHarness,
  type StoredAnswer,
} from './insert-notification.test-fixtures'

const harness = useInsertNotificationHarness({
  orgId: organizationId('org-insert-notification'),
  propertyId: propertyId('86100000-0000-4000-8000-000000000001'),
  userId: userId('user-insert-notification'),
})
const { input, notice, seed, noticeRows, emailRows, noticeById } = harness
const {
  ids: { orgId: ORG_ID, propertyId: PROPERTY_ID, userId: USER_ID },
} = harness

const summaryInput = notice('guest_voice.summary', {
  resourceType: 'property',
  resourceId: `${PROPERTY_ID}:2026-11-09`,
  eventId: 'event-summary-1',
  payload: {
    propertyName: 'Seaview Hotel',
    guestVoiceKind: 'weekly',
    guestVoiceWindow: '90d',
    guestVoiceLines: [
      { kind: 'protect', topic: 'staff_service', reviewCount: 61, textReviewCount: 128 },
    ],
  },
})

/** A matcher list means those exact rows; a number means that many; undefined skips. */
const expectRows = (
  rows: ReadonlyArray<unknown>,
  expected?: ReadonlyArray<unknown> | number,
) => {
  if (expected === undefined) return
  if (typeof expected === 'number') expect(rows).toHaveLength(expected)
  else expect(rows).toEqual(expected)
}

describe.sequential('insertNotification (real PostgreSQL)', () => {
  let deps: InsertNotificationDeps
  beforeEach(() => {
    deps = harness.deps
  })

  // Preference answers in, rows out: every case writes one notice and checks the
  // result, the notice rows, the email rows and whether an immediate email was queued.
  type Routing = Readonly<{
    name: string
    answers?: ReadonlyArray<StoredAnswer>
    notice: InsertNotificationInput
    result: object | null
    notices?: ReadonlyArray<unknown> | number
    emails?: ReadonlyArray<unknown> | number
    enqueued?: 'once' | 'never'
  }>
  const guestVoiceEmail = (cadence: 'immediate' | 'daily'): StoredAnswer => ({
    category: 'guest_voice',
    channel: 'email',
    enabled: true,
    cadence,
  })
  const urgentAlert = (eventId: string, platform?: 'google') =>
    notice('review.ai_urgent_detected', {
      eventId,
      payload: { propertyName: 'Seaview Hotel', ...(platform ? { platform } : {}) },
    })
  const ROUTING: ReadonlyArray<Routing> = [
    {
      name: 'persists a property-scoped in-app notification with governed category',
      notice: input,
      result: {
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        category: 'workflow_collaboration',
      },
      notices: 1,
      emails: 0,
    },
    {
      // ADR 0059: Organization-scoped but not mandatory. ADR 0046's defaults
      // decide it, in-app on, and nothing can opt it into email. A Property's
      // switched-off answers for the same category are never consulted.
      name: 'delivers a report outcome in-app only, with no Property preference to consult',
      answers: [
        { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
        { category: 'workflow_collaboration', channel: 'email', enabled: true },
      ],
      notice: notice('beta_feedback.outcome', {
        propertyId: null,
        resourceType: 'beta_feedback_report',
        resourceId: '00000000-0000-4000-8000-0000000000f1',
        eventId: 'identity-beta-feedback-event-1',
        payload: { reportOutcome: 'resolved' },
      }),
      result: {
        propertyId: null,
        category: 'workflow_collaboration',
        type: 'beta_feedback.outcome',
        resourceType: 'beta_feedback_report',
      },
      notices: 1,
      emails: 0,
      enqueued: 'never',
    },
    {
      name: 'skips every channel when concrete property preferences disable both',
      answers: [
        { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
        { category: 'workflow_collaboration', channel: 'email', enabled: false },
      ],
      notice: input,
      result: null,
      notices: 0,
      emails: 0,
    },
    {
      // Goal email is daily only (ADR 0046, amended 2026-09-22), but a row saved
      // before that may still say immediate. Delivery must not honour it.
      name: 'queues goal email for the daily digest even when a stored row says immediate',
      answers: [
        {
          category: 'portal_goals',
          channel: 'email',
          enabled: true,
          cadence: 'immediate',
        },
      ],
      notice: notice('goal.completed', {
        resourceType: 'goal',
        resourceId: 'goal-1',
        eventId: 'event-goal-1',
        payload: { goalName: 'Weekend response time' },
      }),
      result: {},
      emails: [expect.objectContaining({ category: 'portal_goals', cadence: 'daily' })],
      enqueued: 'never',
    },
    // The Guest voice summary and the Urgent alert (ADR 0046, amended 2026-10-30).
    {
      name: 'persists nothing, and mails nothing, for a manager who never asked for the Monday email',
      notice: summaryInput,
      result: null,
      notices: 0,
      emails: 0,
    },
    {
      // Email only: nothing is returned for the app, and the row the queue anchors
      // on is stored already read, so it never holds the unread key.
      name: 'mails the Monday email at once, as a message of its own, to a manager who turned email on',
      answers: [guestVoiceEmail('immediate')],
      notice: summaryInput,
      result: null,
      notices: [
        expect.objectContaining({
          category: 'guest_voice',
          status: 'read',
          readAt: null,
        }),
      ],
      emails: [
        expect.objectContaining({
          category: 'guest_voice',
          cadence: 'immediate',
          priority: 'normal',
        }),
      ],
      enqueued: 'once',
    },
    {
      name: 'never folds the Monday email into the daily digest, even from a stored row that says daily',
      answers: [guestVoiceEmail('daily')],
      notice: summaryInput,
      result: {},
      emails: [
        expect.objectContaining({ category: 'guest_voice', cadence: 'immediate' }),
      ],
    },
    {
      name: 'shows the Monday row in the app only for a manager who turned the app on',
      answers: [{ category: 'guest_voice', channel: 'in_app', enabled: true }],
      notice: summaryInput,
      result: { category: 'guest_voice', status: 'unread' },
      emails: 0,
    },
    {
      // The existing urgent channel and the reader's existing preferences, nothing new.
      name: 'files the Urgent alert under Action needed, urgent, and mails it at once by default',
      notice: urgentAlert('event-urgent-1', 'google'),
      result: {
        category: 'urgent_operational',
        priority: 'urgent',
        title: 'An urgent review needs you at Seaview Hotel',
      },
      emails: [
        expect.objectContaining({
          category: 'urgent_operational',
          cadence: 'immediate',
          priority: 'urgent',
        }),
      ],
      enqueued: 'once',
    },
    {
      name: 'mails the Urgent alert to nobody who switched urgent email off, and still shows it in the app',
      answers: [
        {
          category: 'urgent_operational',
          channel: 'email',
          enabled: false,
          cadence: 'immediate',
        },
      ],
      notice: urgentAlert('event-urgent-2'),
      result: { category: 'urgent_operational', status: 'unread' },
      emails: 0,
    },
    {
      name: 'defaults Action Required email to immediate while respecting quiet hours',
      notice: notice('portal.health_attention', {
        resourceType: 'portal',
        resourceId: 'portal-1',
        eventId: 'event-portal-health-1',
        payload: {},
      }),
      result: { category: 'urgent_operational', priority: 'normal' },
      emails: [expect.objectContaining({ cadence: 'immediate' })],
      enqueued: 'once',
    },
  ]

  // A loop, not it.each: vitest cuts a long `$name` title short.
  for (const row of ROUTING) {
    it(row.name, async () => {
      await seed(...(row.answers ?? []))

      const result = await insertNotification(deps)(row.notice)

      if (row.result === null) expect(result).toBeNull()
      else expect(result).toMatchObject(row.result)
      expectRows(await noticeRows(), row.notices)
      expectRows(await emailRows(), row.emails)
      if (row.enqueued === 'once') expect(deps.onEmailQueued).toHaveBeenCalledOnce()
      if (row.enqueued === 'never')
        expect(deps.onEmailQueued).not.toHaveBeenCalledWith(
          expect.objectContaining({ cadence: 'immediate' }),
        )
    })
  }

  it('always persists Organization mandatory in-app and immediate email delivery', async () => {
    const result = await insertNotification(deps)(roleChange('identity-role-event-1'))

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
    expect(deps.onEmailQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        id: email!.id,
        organizationId: ORG_ID,
        propertyId: null,
        cadence: 'immediate',
      }),
    )
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
    expect(deps.onEmailQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        id: email!.id,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        cadence: 'immediate',
      }),
    )
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

  const roleChange = (eventId: string) =>
    notice('account.organization_role_changed', {
      propertyId: null,
      resourceType: 'organization',
      resourceId: ORG_ID,
      eventId,
    })

  it('emails a repeat mandatory notice that coalesced into the unread row', async () => {
    const first = (await insertNotification(deps)(roleChange('identity-role-event-1')))!
    const repeatDeps = buildInsertNotificationDeps(harness.held.db)

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
    expect(repeatDeps.onEmailQueued).toHaveBeenCalledOnce()
    expect(repeatDeps.onEmailQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        id: repeatEmail[0]!.id,
        organizationId: ORG_ID,
        propertyId: null,
      }),
    )
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
    const replayDeps = buildInsertNotificationDeps(harness.held.db)

    await insertNotification(replayDeps)(roleChange('identity-role-event-1'))

    expect(await emailRows()).toHaveLength(1)
    expect(replayDeps.onEmailQueued).not.toHaveBeenCalled()
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
    const goal = notice('goal.completed', {
      resourceType: 'goal',
      resourceId: 'goal-1',
      eventId: 'event-goal-1',
      payload: {
        propertyName: 'Seaview Hotel',
        goalName: 'Monthly portal goal',
        goalMonth: '2026-11',
        goalSubjectKind: 'property',
        goalOutcome: 'met',
        goalMeasure: 'portal_rating_count',
        goalCount: 41,
        goalTargetCount: 40,
      },
    })

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

  // `integration.reauthorization_required` anchors on a Property so it can be
  // mailed. With no active Property to anchor on it falls back to the
  // Organization: in the bell, never by email, rather than to nobody.
  it('lands a Google reauthorization notice without a Property in the bell, with no email', async () => {
    await seed(
      { category: 'urgent_operational', channel: 'email', enabled: true },
      { category: 'urgent_operational', channel: 'in_app', enabled: true },
    )

    const result = await insertNotification(deps)(
      notice('integration.reauthorization_required', {
        propertyId: null,
        resourceType: 'integration',
        resourceId: '00000000-0000-4000-8000-0000000000e2',
        payload: { reauthorizationCause: 'provider_revoked' },
      }),
    )

    expect(result).toMatchObject({
      propertyId: null,
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
    })
    expect(
      await harness.held.db
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
    expect(deps.onEmailQueued).not.toHaveBeenCalled()
  })
})
