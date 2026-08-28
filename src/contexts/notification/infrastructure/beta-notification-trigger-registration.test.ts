import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { assertBetaNotificationTriggerMatrix } from '../application/beta-notification-trigger-matrix'
import { createEventHandlerDeps } from './event-handlers/test-fixtures'
import { registerNotificationConsumers } from './outbox-consumers'
import { registerWorkflowNotificationConsumers } from './workflow-outbox-consumers'
import { registerPortalNotificationConsumers } from './portal-outbox-consumers'
import { registerPropertyNotificationConsumers } from './property-outbox-consumers'
import { registerIntegrationNotificationConsumers } from './integration-outbox-consumers'
import { registerBulkAssignmentNotificationConsumer } from './bulk-assignment-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from './escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from './goal-outbox-consumers'
import { registerHandlingCycleNotificationConsumers } from './handling-cycle-outbox-consumers'
import { registerResponseTargetNotificationConsumer } from './response-target-outbox-consumers'
import { registerPortalHealthNotificationConsumer } from './portal-health-outbox-consumers'
import { registerIdentityAccountNotificationConsumers } from './identity-account-outbox-consumers'

describe('registered durable notification matrix', () => {
  beforeEach(clearConsumers)
  afterEach(clearConsumers)

  it('matches the consumers actually registered by the worker composition', () => {
    const fakes = createEventHandlerDeps()
    const receipts = { insertReceipt: vi.fn(async () => {}) }

    registerIdentityAccountNotificationConsumers({ queue: fakes.queue, receipts })

    registerNotificationConsumers({ ...fakes, receipts })
    registerWorkflowNotificationConsumers({ ...fakes, receipts })
    registerBulkAssignmentNotificationConsumer({
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      receipts,
    })
    registerEscalationResolutionNotificationConsumer({
      queue: fakes.queue,
      escalationResolutions: {
        findEscalationResolutionFacts: vi.fn(async () => null),
      },
      responsibleManagers: fakes.responsibleManagers,
      receipts,
    })
    registerHandlingCycleNotificationConsumers({ ...fakes, receipts })
    registerResponseTargetNotificationConsumer({ ...fakes, receipts })
    registerGoalNotificationConsumer({
      queue: fakes.queue,
      monthlyResultFacts: {
        findMonthlyResultNotificationFacts: vi.fn(async () => null),
        findMonthlyResultRevisionNotificationFacts: vi.fn(async () => null),
      },
      responsibleManagers: fakes.responsibleManagers,
      userLookup: fakes.userLookup,
      receipts,
    })
    registerPortalNotificationConsumers({
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerPortalHealthNotificationConsumer({
      queue: fakes.queue,
      responsibleManagers: fakes.responsibleManagers,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerPropertyNotificationConsumers({
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerIntegrationNotificationConsumers({
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      googleConnectionProperties: {
        findGoogleNotificationAnchor: vi.fn(async () => null),
      },
      logger: fakes.logger,
      receipts,
    })

    expect(() =>
      assertBetaNotificationTriggerMatrix(listRegisteredConsumers()),
    ).not.toThrow()
  })
})
