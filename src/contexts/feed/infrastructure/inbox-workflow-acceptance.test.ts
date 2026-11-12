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
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxHandlingCycleReopened,
  inboxItemAssigned,
} from '#/contexts/inbox/domain/events'
import {
  currentRouteDeps,
  deliveredEnvelope,
  dispatch,
} from '#/shared/testing/notification-route-test-harness'
import {
  ACTOR,
  BULK,
  DEPARTING,
  handlingCycleScope,
  ITEM,
  MANAGER,
  ORG,
  OCCURRED_AT,
  PRODUCED_FACTS,
  PROPERTY,
  RECIPIENT,
} from '#/shared/testing/notification-route-producer-fixtures'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'
import { handleWorkflowNotificationEvent } from '../notify/inbox-workflow.server'
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

describe('Inbox workflow facts through their producers and dispatcher', () => {
  it.each([
    {
      eventType: 'inbox.inbox_items.bulk_reopen_completed',
      type: 'inbox.bulk_reopened',
      payload: {
        propertyName: 'Riverside Hotel',
        itemCount: 1,
        actorRole: 'property_manager',
      },
      title: '1 item reopened at Riverside Hotel',
      body: 'A property manager reopened an item. Open the Inbox to take a look.',
    },
    {
      eventType: 'inbox.inbox_items.assignments_released',
      type: 'inbox.assignments_released',
      payload: { propertyName: 'Riverside Hotel', itemCount: 1 },
      title: '1 item left unassigned at Riverside Hotel',
      body: 'an item at this property lost their assignee. Give them a new one.',
    },
    {
      eventType: 'inbox.inbox_item.escalated',
      type: 'inbox.escalated',
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        actorRole: 'property_manager',
      },
      title: 'Escalated: review at Riverside Hotel',
      body: 'A property manager escalated this for your attention. Open it to see where it stands.',
    },
    {
      eventType: 'inbox.inbox_item.escalation_resolved',
      type: 'inbox.escalation_resolved',
      payload: { propertyName: 'Riverside Hotel' },
      title: 'Escalation resolved at Riverside Hotel',
      body: 'This item is no longer escalated. Open it to see where it stands.',
    },
    {
      eventType: 'inbox.inbox_note.added',
      type: 'inbox_note.added',
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        actorRole: 'property_manager',
      },
      title: 'New internal note on a review at Riverside Hotel',
      body: 'A property manager left a note on this item. Open it to read the thread.',
    },
  ] as const)('$eventType keeps its payload and copy', async (example) => {
    const fact = PRODUCED_FACTS[example.eventType]!()
    const result = await dispatch(fact)
    expect(result.gateDenials).toEqual([])
    expect(result.queued).toHaveLength(1)
    const job = result.queued[0]!
    expect(job).toMatchObject({
      userId: MANAGER,
      organizationId: ORG,
      propertyId: PROPERTY,
      resourceType: 'inbox_item',
      resourceId: ITEM,
      eventId: fact.eventId,
      type: example.type,
    })
    expect(job.payload).toEqual(example.payload)
    expect(
      renderNotification(job.type, parseNotificationPayload(job.payload)),
    ).toMatchObject({
      title: example.title,
      body: example.body,
    })

    const completed = new Set(result.receipts.map(({ consumerName }) => consumerName))
    const replay = await dispatch(fact, currentRouteDeps(), {
      outbox: {
        hasReceipt: async (_eventId, consumerName) => completed.has(consumerName),
        insertReceipt: async () => {},
      },
    })
    expect(replay.queued).toEqual([])
  })

  it('deduplicates note recipients and keeps the strongest audience while excluding the author', async () => {
    const deps = currentRouteDeps()
    const facts = await deps.inboxItemLookup.findInboxItemFacts()
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      ...facts,
      assignedTo: RECIPIENT,
    })
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      ACTOR,
      MANAGER,
      RECIPIENT,
    ])
    deps.inboxItemLookup.findNoteAuthors.mockResolvedValue([ACTOR, MANAGER, RECIPIENT])
    const result = await dispatch(PRODUCED_FACTS['inbox.inbox_note.added']!(), deps)
    expect(result.queued.map(({ userId, audience }) => ({ userId, audience }))).toEqual([
      {
        userId: MANAGER,
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: PROPERTY },
        },
      },
      { userId: RECIPIENT, audience: { kind: 'inbox_assignee', inboxItemId: ITEM } },
    ])
  })

  for (const family of ['assignment', 'reopen'] as const) {
    it.each(['per-item-first', 'bulk-first'] as const)(
      `${family}: only the bulk completion announces work in %s order`,
      async (order) => {
        const perItem =
          family === 'assignment'
            ? inboxItemAssigned({
                inboxItemId: ITEM,
                organizationId: ORG,
                propertyId: PROPERTY,
                assignedTo: RECIPIENT,
                previousAssignee: DEPARTING,
                userId: ACTOR,
                bulkId: BULK,
                source: 'web',
                occurredAt: OCCURRED_AT,
              })
            : inboxHandlingCycleReopened({
                ...handlingCycleScope,
                actorType: 'user',
                userId: ACTOR,
                bulkId: BULK,
                reopenReason: 'new_information',
                source: 'web',
              })
        const bulk =
          PRODUCED_FACTS[
            family === 'assignment'
              ? 'inbox.inbox_items.bulk_assignment_completed'
              : 'inbox.inbox_items.bulk_reopen_completed'
          ]!()
        const facts = order === 'per-item-first' ? [perItem, bulk] : [bulk, perItem]
        const results: Awaited<ReturnType<typeof dispatch>>[] = []
        for (const fact of facts) results.push(await dispatch(fact))
        expect(results[facts.indexOf(perItem)]!.queued).toEqual([])
        expect(results.flatMap(({ queued }) => queued.map(({ type }) => type))).toEqual(
          family === 'assignment'
            ? ['inbox.bulk_assigned', 'inbox.bulk_unassigned']
            : ['inbox.bulk_reopened'],
        )
      },
    )
  }

  it.each([
    'inbox.inbox_item.assigned',
    'inbox.inbox_item.escalated',
    'inbox.inbox_note.added',
  ])(
    '%s retries partial fanout under identical recipient job identities before acknowledging',
    async (eventType) => {
      const deps = currentRouteDeps()
      deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER, RECIPIENT])
      const event = deliveredEnvelope(PRODUCED_FACTS[eventType]!())
      deps.addMock.mockRejectedValueOnce(new Error('queue unavailable'))
      await expect(handleWorkflowNotificationEvent(deps, event)).rejects.toThrow(
        'queue unavailable',
      )
      expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
      const attempted = deps.addMock.mock.calls.map(([, data, options]) => ({
        data,
        options,
      }))
      deps.addMock.mockClear()
      await handleWorkflowNotificationEvent(deps, event)
      const retried = deps.addMock.mock.calls.map(([, data, options]) => ({
        data,
        options,
      }))
      expect(retried.slice(0, attempted.length)).toEqual(attempted)
      for (const { data, options } of retried) {
        const job = data as InsertNotificationJobData
        expect(options).toEqual({ jobId: `${event.eventId}-${job.userId}` })
      }
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        event.eventId,
        expect.any(String),
        'applied',
      )
    },
  )
})
