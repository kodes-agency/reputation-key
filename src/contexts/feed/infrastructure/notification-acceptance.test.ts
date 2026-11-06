import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  inboxHandlingCycleReopened,
  inboxItemCreated,
  inboxResponseTargetReminderDue,
} from '#/contexts/inbox/domain/events'
import { goalRatingGoalTransitioned } from '#/contexts/reporting/domain/goal-events'
import type { RatingGoalNotice } from '#/contexts/reporting/domain/rating-goal-notices'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { notificationId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../application/beta-notification-trigger-matrix'
import { createNotification } from '../domain/notification-constructors'
import { resolveCategoryPreference } from '../domain/notification-preference-resolution'
import type { NotificationType } from '../domain/notification-types'
import {
  currentRouteDeps,
  dispatch,
  expectAnnouncingRoute,
} from '#/shared/testing/notification-route-test-harness'
import {
  ACTOR,
  DEPARTING,
  handlingCycleScope,
  ITEM,
  MANAGER,
  OCCURRED_AT,
  ORG,
  PORTAL,
  PRODUCED_FACTS,
  PROPERTY,
  RECIPIENT,
  REVIEW,
  SCHEDULED_FOR,
} from '#/shared/testing/notification-route-producer-fixtures'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'

beforeAll(registerAllEventSchemas)
beforeEach(() => {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORG }))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
})
afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

const notificationFor = (job: InsertNotificationJobData) =>
  createNotification(
    { ...job, id: notificationId('4d1f0c1e-2b7a-4c55-9a51-000000000099') },
    () => OCCURRED_AT,
  )._unsafeUnwrap()

describe('producer-route acceptance controls', () => {
  it('detects a missing inviter consumer even while the new-member consumer still runs', async () => {
    const route = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
      (row) =>
        row.consumerName === 'notification.on-identity-invitation-accepted-inviter',
    )!
    const fact = PRODUCED_FACTS['identity.invitation.accepted']!()
    expectAnnouncingRoute(route, await dispatch(fact))

    const missing = await dispatch(fact, currentRouteDeps(), {
      omitConsumer: route.consumerName,
    })
    expect(missing.queued.map((job) => job.type)).toEqual([
      'account.organization_access_granted',
    ])
    expect(() => expectAnnouncingRoute(route, missing)).toThrowError(
      expect.objectContaining({
        name: 'AssertionError',
        expected: {
          eventId: missing.envelope.eventId,
          consumerName: route.consumerName,
          status: 'applied',
        },
      }),
    )
  })

  for (const eventType of [
    'inbox.inbox_item.assigned',
    'inbox.inbox_items.bulk_assignment_completed',
  ] as const) {
    it(`${eventType}: detects either missing reassignment branch`, async () => {
      const route = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
        (row) => row.eventType === eventType,
      )!
      const result = await dispatch(PRODUCED_FACTS[eventType]!())
      expectAnnouncingRoute(route, result)

      for (const { type } of route.notifications) {
        expect(() =>
          expectAnnouncingRoute(route, {
            ...result,
            queued: result.queued.filter((job) => job.type !== type),
          }),
        ).toThrowError(expect.objectContaining({ name: 'AssertionError' }))
      }
    })
  }
})

describe('reassignment acceptance through producers and dispatcher', () => {
  it.each([
    {
      eventType: 'inbox.inbox_item.assigned',
      notices: [
        {
          userId: RECIPIENT,
          type: 'inbox.assigned',
          audience: { kind: 'inbox_assignee', inboxItemId: ITEM },
          title: 'Assigned to you: review at Riverside Hotel',
          body: 'A property manager assigned this to you. The next step is yours.',
        },
        {
          userId: DEPARTING,
          type: 'inbox.unassigned',
          audience: { kind: 'property_operator' },
          title: 'No longer yours: review at Riverside Hotel',
          body: 'A property manager passed this on. Somebody else is handling it now.',
        },
      ],
    },
    {
      eventType: 'inbox.inbox_items.bulk_assignment_completed',
      notices: [
        {
          userId: RECIPIENT,
          type: 'inbox.bulk_assigned',
          audience: { kind: 'bulk_inbox_assignee', inboxItemIds: [ITEM] },
          title: '1 item assigned to you at Riverside Hotel',
          body: 'A property manager assigned an item to you. Open the Inbox to see your work.',
        },
        {
          userId: DEPARTING,
          type: 'inbox.bulk_unassigned',
          audience: { kind: 'property_operator' },
          title: '1 item no longer yours at Riverside Hotel',
          body: 'A property manager reassigned an item you held to somebody else.',
        },
      ],
    },
  ] as const)(
    '$eventType keeps exact recipients, types, categories, defaults and copy',
    async ({ eventType, notices }) => {
      const result = await dispatch(PRODUCED_FACTS[eventType]!())
      const route = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
        (row) => row.eventType === eventType,
      )!
      expectAnnouncingRoute(route, result)
      expect(result.queued.map(({ userId, type }) => ({ userId, type }))).toEqual(
        notices.map(({ userId, type }) => ({ userId, type })),
      )

      for (const [index, expected] of notices.entries()) {
        const job = result.queued[index]!
        expect(job).toMatchObject({
          userId: expected.userId,
          type: expected.type,
          organizationId: ORG,
          propertyId: PROPERTY,
          resourceType: 'inbox_item',
          resourceId: ITEM,
          eventId: result.envelope.eventId,
          audience: expected.audience,
        })
        const notification = notificationFor(job)
        expect(notification).toMatchObject({
          category: 'workflow_collaboration',
          priority: 'normal',
          title: expected.title,
          body: expected.body,
        })
        for (const channel of ['in_app', 'email'] as const) {
          expect(
            resolveCategoryPreference({
              category: notification.category,
              channel,
              property: null,
              personalDefault: null,
            }),
          ).toEqual({ enabled: channel === 'in_app', cadence: 'daily' })
        }
      }
    },
  )
})

describe('response-target reminder acceptance', () => {
  for (const sourceType of ['review', 'feedback'] as const) {
    for (const reminderKind of ['halfway', 'target_passed'] as const) {
      it(`${sourceType}: ${reminderKind} keeps its recipient, category, defaults and copy`, async () => {
        const targetKind =
          sourceType === 'review' ? 'google_review_response' : 'private_feedback_handling'
        const deps = currentRouteDeps()
        const facts = {
          propertyId: PROPERTY,
          portalId: sourceType === 'feedback' ? PORTAL : null,
          assignedTo: null,
          propertyName: 'Riverside Hotel',
          guestRating: null,
          sourceType,
          sourceId: REVIEW,
          createdAt: OCCURRED_AT,
          currentCycleNumber: handlingCycleScope.cycleNumber,
          currentSourceRevision: handlingCycleScope.sourceRevision,
          stateRevision: handlingCycleScope.stateRevision,
          status: 'open',
          targetKind,
          reminderKind,
          scheduledFor: SCHEDULED_FOR,
          dueAt: SCHEDULED_FOR,
        }
        deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
          facts,
        )
        deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(facts)
        const result = await dispatch(
          inboxResponseTargetReminderDue({
            inboxItemId: ITEM,
            cycleNumber: handlingCycleScope.cycleNumber,
            organizationId: ORG,
            propertyId: PROPERTY,
            targetKind,
            reminderKind,
            scheduledFor: SCHEDULED_FOR,
            occurredAt: OCCURRED_AT,
          }),
          deps,
        )

        expect(result.gateDenials).toEqual([])
        expect(result.queued).toHaveLength(1)
        const job = result.queued[0]!
        const category =
          reminderKind === 'halfway' ? 'workflow_collaboration' : 'urgent_operational'
        expect(job).toMatchObject({
          userId: MANAGER,
          organizationId: ORG,
          propertyId: PROPERTY,
          type:
            reminderKind === 'halfway'
              ? 'inbox.response_target_halfway'
              : 'inbox.response_target_passed',
          resourceId: ITEM,
          audience: {
            kind: 'response_target_reminder',
            sourceType,
            targetKind,
            reminderKind,
          },
        })
        expect(notificationFor(job)).toMatchObject({
          category,
          priority: 'normal',
          title:
            reminderKind === 'halfway'
              ? 'Halfway to the response target at Riverside Hotel'
              : 'Response target passed at Riverside Hotel',
        })
        expect(
          resolveCategoryPreference({
            category,
            channel: 'email',
            property: null,
            personalDefault: null,
          }),
        ).toMatchObject({
          enabled: reminderKind === 'target_passed',
          cadence: reminderKind === 'halfway' ? 'daily' : 'immediate',
        })
      })
    }
  }

  it.each(['arrival', 'reopen'] as const)(
    'keeps private-feedback %s with Portal responsibility',
    async (kind) => {
      const deps = currentRouteDeps()
      const source = {
        ...handlingCycleScope,
        sourceType: 'feedback',
        sourceRevision: 1,
      } as const
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
        ...source,
        currentCycleNumber: source.cycleNumber,
        currentSourceRevision: 1,
        portalId: PORTAL,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: 2,
        createdAt: OCCURRED_AT,
        status: 'open',
      })
      deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
        propertyId: PROPERTY,
        portalId: PORTAL,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: 2,
        sourceType: 'feedback',
        createdAt: OCCURRED_AT,
      })
      deps.responsibleManagers.findForPortal.mockResolvedValue(
        kind === 'reopen' ? [ACTOR, MANAGER] : [MANAGER],
      )
      const fact =
        kind === 'reopen'
          ? inboxHandlingCycleReopened({
              ...source,
              actorType: 'user',
              userId: ACTOR,
              reopenReason: 'new_information',
              source: 'web',
            })
          : inboxItemCreated({
              inboxItemId: ITEM,
              organizationId: ORG,
              propertyId: PROPERTY,
              sourceType: 'feedback',
              sourceId: REVIEW,
              occurredAt: OCCURRED_AT,
            })
      const result = await dispatch(fact, deps)
      expect(result.gateDenials).toEqual([])
      expect(result.queued.map((job) => [job.userId, job.type])).toEqual([
        [MANAGER, kind === 'reopen' ? 'inbox.reopened' : 'feedback.created'],
      ])
      expect(notificationFor(result.queued[0]!)).toMatchObject({
        category: kind === 'reopen' ? 'urgent_operational' : 'arrivals',
        payload: { guestRating: 2 },
      })
    },
  )
})

const RATING_EXAMPLES: ReadonlyArray<
  Readonly<{
    notice: RatingGoalNotice
    type: NotificationType
    title: string
  }>
> = [
  {
    notice: { transition: 'reached', targetTenths: 45, shownTenths: 45 },
    type: 'goal.rating_reached',
    title: 'Google now shows 4.5 for Riverside Hotel: goal reached',
  },
  {
    notice: {
      transition: 'google_rating_changed',
      mode: 'climb',
      targetTenths: 45,
      shownTenths: 44,
      previousTenths: 43,
    },
    type: 'goal.rating_changed',
    title: 'Google now shows 4.4 for Riverside Hotel, up from 4.3',
  },
  {
    notice: {
      transition: 'entered_below_pace',
      targetTenths: 45,
      paceTenthsPerWeek: 110,
      pacePerWeek: 11,
      recentPaceTenths: 65,
      paceWindow: 'last_4_weeks',
    },
    type: 'goal.rating_below_pace',
    title: 'Riverside Hotel is below its Google review pace',
  },
  {
    notice: { transition: 'entered_reviews_too_low', targetTenths: 45 },
    type: 'goal.rating_too_low',
    title: 'New Google reviews for Riverside Hotel are too low for 4.5',
  },
  {
    notice: { transition: 'keep_dropped_below', targetTenths: 47, shownTenths: 46 },
    type: 'goal.rating_keep_dropped',
    title: 'Google now shows 4.6 for Riverside Hotel, below the 4.7 you’re keeping',
  },
]

describe('every Google rating-goal transition from its producer', () => {
  it.each(RATING_EXAMPLES)(
    '$type keeps responsibility, recognition preferences and copy',
    async ({ notice, type, title }) => {
      const result = await dispatch(
        goalRatingGoalTransitioned({
          organizationId: ORG,
          propertyId: PROPERTY,
          goalId: '4d1f0c1e-2b7a-4c55-9a51-000000000014',
          mode: notice.transition === 'keep_dropped_below' ? 'keep' : 'climb',
          notice,
          occurredAt: OCCURRED_AT,
        }),
      )
      expect(result.gateDenials).toEqual([])
      expect(result.queued).toHaveLength(1)
      expect(result.queued[0]).toMatchObject({
        userId: MANAGER,
        organizationId: ORG,
        propertyId: PROPERTY,
        type,
      })
      expect(notificationFor(result.queued[0]!)).toMatchObject({
        category: 'recognition',
        title,
      })
      expect(
        resolveCategoryPreference({
          category: 'recognition',
          channel: 'email',
          property: null,
          personalDefault: null,
        }),
      ).toMatchObject({ enabled: false, cadence: 'daily' })
    },
  )
})
