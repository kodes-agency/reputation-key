// Who hears that an Inbox item was escalated when the person asking for help
// is the only one its scope names.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { unbrand, type UserId } from '#/shared/domain/ids'
import { handleWorkflowNotificationEvent } from './workflow-outbox-consumers'
import { NOTIF_TEST_IDS } from './notification-consumer-test-fixtures'
import {
  makeWorkflowDeps,
  queuedJobs,
  workflowEvent,
} from './workflow-consumer-test-harness'

const escalated = (actorId: UserId) =>
  workflowEvent('inbox.inbox_item.escalated', {
    inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
    userId: unbrand(actorId),
    source: 'web',
  })

describe('an escalation raised by the only responsible manager', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  it('reaches the AccountAdmins, who are who is left to help', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
    ])
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.manager1))

    // The admins are not the item's responsible scope, which still names the
    // escalating manager, so the send rechecks them as AccountAdmins.
    expect(queuedJobs(deps)).toEqual([
      expect.objectContaining({
        userId: NOTIF_TEST_IDS.admin1,
        type: 'inbox.escalated',
        audience: { kind: 'account_admin' },
      }),
    ])
  })

  it('never falls back to the escalating AccountAdmin themselves', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
    ])
    deps.fakes.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.admin1))

    expect(queuedJobs(deps).map((job) => job.userId)).toEqual([NOTIF_TEST_IDS.admin2])
  })

  it('says so when nobody at all is left to tell', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
    ])
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.admin1))

    expect(queuedJobs(deps)).toEqual([])
    expect(deps.fakes.logger.warn).toHaveBeenCalledWith(
      { correlationId: 'correlation-1' },
      'notification escalation delivery: nobody besides the escalating actor, skipping',
    )
  })

  it('keeps the scope audience while the scope still has somebody else', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.manager1))

    expect(queuedJobs(deps)).toEqual([
      expect.objectContaining({
        userId: NOTIF_TEST_IDS.manager2,
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: unbrand(NOTIF_TEST_IDS.propId) },
        },
      }),
    ])
    expect(deps.fakes.userLookup.findByRole).not.toHaveBeenCalled()
  })
})
