import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
import { notificationId, notificationPreferenceId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  currentRouteDeps,
  dispatch,
} from '#/shared/testing/notification-route-test-harness'
import {
  ACTOR,
  ITEM,
  MANAGER,
  OCCURRED_AT,
  ORG,
  PRODUCED_FACTS,
  PROPERTY,
  RECIPIENT,
} from '#/shared/testing/notification-route-producer-fixtures'
import { createNotification } from '../domain/notification-constructors'
import {
  createNotificationCategoryDefault,
  createNotificationPreference,
} from '../domain/constructors-preference'
import { updateNotificationPreferenceDto } from '../preferences/contracts'
import { resolveCategoryPreference } from '../domain/notification-preference-resolution'
import type { NotificationCategory, NotificationType } from '../domain/notification-types'
import type { QueuedNotice } from './notification-consumer-test-fixtures'

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

const notificationFor = (job: QueuedNotice) =>
  createNotification(
    { ...job, id: notificationId('4d1f0c1e-2b7a-4c55-9a51-000000000099') },
    () => OCCURRED_AT,
  )._unsafeUnwrap()

type OutcomeExample = Readonly<{
  eventType: string
  type: NotificationType
  category: NotificationCategory
  title: string
  body: string
}>

const REPLY_EXAMPLES: readonly OutcomeExample[] = [
  {
    eventType: 'review.reply.approved',
    type: 'reply.approved',
    category: 'workflow_collaboration',
    title: 'Your reply was approved at Riverside Hotel',
    body: 'It is queued to publish to Google.',
  },
  {
    eventType: 'review.reply.rejected',
    type: 'reply.rejected',
    category: 'workflow_collaboration',
    title: 'Your reply needs changes at Riverside Hotel',
    body: 'It was sent back without a reason. Edit it and resubmit.',
  },
  {
    eventType: 'review.reply.published',
    type: 'reply.published',
    category: 'workflow_collaboration',
    title: 'Your reply is live on Google at Riverside Hotel',
    body: 'Guests can see it now. No further action needed.',
  },
  {
    eventType: 'review.reply.publish_failed',
    type: 'reply.publish_failed',
    category: 'urgent_operational',
    title: 'Reply not published at Riverside Hotel',
    body: 'Nothing was posted to Google, so it is safe to try again.',
  },
]

describe('reply outcomes through real producers and the dispatcher', () => {
  it.each(REPLY_EXAMPLES)(
    '$eventType preserves author delivery, copy and channel defaults',
    async ({ eventType, type, category, title, body }) => {
      const result = await dispatch(PRODUCED_FACTS[eventType]!())
      expect(result.gateDenials).toEqual([])
      expect(result.queued).toHaveLength(1)
      const job = result.queued[0]!
      expect(job).toMatchObject({
        userId: RECIPIENT,
        organizationId: ORG,
        propertyId: PROPERTY,
        type,
        resourceType: 'inbox_item',
        resourceId: ITEM,
        eventId: result.envelope.eventId,
        audience: { kind: 'property_operator' },
      })
      expect(notificationFor(job)).toMatchObject({ category, title, body })
      for (const channel of ['in_app', 'email'] as const) {
        expect(
          resolveCategoryPreference({
            category,
            channel,
            property: null,
            personalDefault: null,
          }),
        ).toEqual({
          enabled: channel === 'in_app' || category === 'urgent_operational',
          cadence: category === 'urgent_operational' ? 'immediate' : 'daily',
        })
      }
    },
  )

  it('keeps the same failure facts and copy when the responsible manager must retry', async () => {
    const deps = currentRouteDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
    const result = await dispatch(PRODUCED_FACTS['review.reply.publish_failed']!(), deps)

    expect(result.gateDenials).toEqual([])
    expect(result.queued).toHaveLength(1)
    expect(result.queued[0]).toMatchObject({
      userId: MANAGER,
      type: 'reply.publish_failed',
      resourceId: ITEM,
      payload: { publishOutcome: 'not_sent' },
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: PROPERTY },
      },
    })
    expect(notificationFor(result.queued[0]!)).toMatchObject({
      category: 'urgent_operational',
      title: 'Reply not published at Riverside Hotel',
      body: 'Nothing was posted to Google, so it is safe to try again.',
    })
  })
})

describe('other notification family routes', () => {
  it('tells both the new member and the inviter without merging their mandatory notices', async () => {
    const result = await dispatch(PRODUCED_FACTS['identity.invitation.accepted']!())
    expect(result.gateDenials).toEqual([])
    expect(result.queued.map(({ userId, type }) => ({ userId, type }))).toEqual([
      { userId: RECIPIENT, type: 'account.organization_access_granted' },
      { userId: ACTOR, type: 'account.invitation_accepted' },
    ])
    expect(result.queued.map(notificationFor)).toMatchObject([
      {
        category: 'mandatory',
        title: 'Organization access added',
        body: 'Your account can now access this organization.',
      },
      {
        category: 'mandatory',
        title: 'An invitation you sent was accepted',
        body: 'Someone you invited joined. Review their properties in Members.',
      },
    ])
    expect(result.queued.every((job) => job.propertyId === null)).toBe(true)
  })

  it.each([
    {
      eventType: 'inbox.handling_cycle.opened',
      type: 'review.updated',
      category: 'arrivals',
      title: 'Review updated at Riverside Hotel',
      body: 'The guest changed their review. Open it to check the latest details.',
    },
    {
      eventType: 'review.property_history_import.finished',
      type: 'property.review_import_finished',
      category: 'workflow_collaboration',
      title: 'Review history imported at Riverside Hotel',
      body: 'We imported 260 reviews. Nothing is waiting for a reply.',
    },
    {
      eventType: 'goal.monthly_result.closed',
      type: 'goal.completed',
      category: 'portal_goals',
      title: 'Riverside Hotel met its October portal goal',
      body: 'Your portals brought in 41 private ratings. The goal was 40.',
    },
    {
      eventType: 'goal.monthly_result.revised',
      type: 'goal.result_revised',
      category: 'portal_goals',
      title: 'Riverside Hotel’s October portal goal: now met',
      body: 'A correction changed October to 41 of 40.',
    },
    {
      eventType: 'identity.beta_feedback.outcome_reached',
      type: 'beta_feedback.outcome',
      category: 'workflow_collaboration',
      title: 'Your report was accepted',
      body: 'It will be worked on.',
    },
  ] satisfies readonly OutcomeExample[])(
    '$eventType preserves its type, category and copy',
    async ({ eventType, type, category, title, body }) => {
      const result = await dispatch(PRODUCED_FACTS[eventType]!())
      expect(result.gateDenials).toEqual([])
      expect(result.queued).toHaveLength(1)
      expect(result.queued[0]).toMatchObject({
        organizationId: ORG,
        type,
        eventId: result.envelope.eventId,
      })
      expect(notificationFor(result.queued[0]!)).toMatchObject({
        category,
        title,
        body,
      })
    },
  )
})

describe('independent Google rating and Portal goal preferences', () => {
  for (const category of ['recognition', 'portal_goals'] as const) {
    for (const channel of ['in_app', 'email'] as const) {
      it(`${category}/${channel} preserves its saved answer and inheritance`, () => {
        const saved = updateNotificationPreferenceDto.parse(
          JSON.parse(
            JSON.stringify({
              propertyId: PROPERTY,
              category,
              channel,
              enabled: false,
              cadence: 'daily',
            }),
          ),
        )
        const personalDefault = createNotificationCategoryDefault(
          {
            userId: RECIPIENT,
            organizationId: ORG,
            category,
            channel,
            enabled: true,
            cadence: 'daily',
          },
          () => OCCURRED_AT,
        )._unsafeUnwrap()
        const propertyPreference = createNotificationPreference(
          {
            ...saved,
            id: notificationPreferenceId('4d1f0c1e-2b7a-4c55-9a51-000000000098'),
            propertyId: PROPERTY,
            userId: RECIPIENT,
            organizationId: ORG,
          },
          () => OCCURRED_AT,
        )._unsafeUnwrap()
        const readBack = updateNotificationPreferenceDto.parse(
          JSON.parse(JSON.stringify(propertyPreference)),
        )

        expect(readBack).toEqual(saved)
        expect(propertyPreference.category).toBe(category)
        expect(personalDefault.category).toBe(category)
        expect(
          resolveCategoryPreference({
            category,
            channel,
            property: readBack,
            personalDefault,
          }),
        ).toEqual({ enabled: false, cadence: 'daily' })
        expect(
          resolveCategoryPreference({
            category,
            channel,
            property: null,
            personalDefault,
          }),
        ).toEqual({ enabled: true, cadence: 'daily' })
        expect(
          resolveCategoryPreference({
            category,
            channel,
            property: null,
            personalDefault: null,
          }),
        ).toEqual({ enabled: channel === 'in_app', cadence: 'daily' })
      })
    }
  }

  it('keeps opposite choices for the two goal categories across the API round trip', () => {
    const choices = [
      { category: 'recognition', enabled: false },
      { category: 'portal_goals', enabled: true },
    ] as const
    const readBack = choices.map(({ category, enabled }) =>
      updateNotificationPreferenceDto.parse(
        JSON.parse(
          JSON.stringify({
            propertyId: PROPERTY,
            category,
            enabled,
            channel: 'email',
            cadence: 'daily',
          }),
        ),
      ),
    )
    expect(readBack.map(({ category, enabled }) => ({ category, enabled }))).toEqual(
      choices,
    )
    expect(
      readBack.map((preference) =>
        resolveCategoryPreference({
          category: preference.category,
          channel: preference.channel,
          property: preference,
          personalDefault: null,
        }),
      ),
    ).toEqual([
      { enabled: false, cadence: 'daily' },
      { enabled: true, cadence: 'daily' },
    ])
  })
})
