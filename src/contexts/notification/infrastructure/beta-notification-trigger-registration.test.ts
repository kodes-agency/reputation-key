import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
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
import {
  registerIdentityAccountNotificationConsumers,
  registerOrganizationPurgePendingNoticeConsumer,
} from './identity-account-outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

describe('registered durable notification matrix', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
  })

  it('matches the consumers actually registered by the worker composition', () => {
    const fakes = createEventHandlerDeps()
    const receipts = { insertReceipt: vi.fn(async () => {}) }

    registerIdentityAccountNotificationConsumers(consumerRegistry, {
      queue: fakes.queue,
      receipts,
    })
    // LIF-01 bullet 5 — the mandatory Purge Pending final notice.
    registerOrganizationPurgePendingNoticeConsumer(consumerRegistry, {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })

    registerNotificationConsumers(consumerRegistry, { ...fakes, receipts })
    registerWorkflowNotificationConsumers(consumerRegistry, { ...fakes, receipts })
    registerBulkAssignmentNotificationConsumer(consumerRegistry, {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      receipts,
    })
    registerEscalationResolutionNotificationConsumer(consumerRegistry, {
      queue: fakes.queue,
      escalationResolutions: {
        findEscalationResolutionFacts: vi.fn(async () => null),
      },
      responsibleManagers: fakes.responsibleManagers,
      receipts,
    })
    registerHandlingCycleNotificationConsumers(consumerRegistry, { ...fakes, receipts })
    registerResponseTargetNotificationConsumer(consumerRegistry, { ...fakes, receipts })
    registerGoalNotificationConsumer(consumerRegistry, {
      queue: fakes.queue,
      monthlyResultFacts: {
        findMonthlyResultNotificationFacts: vi.fn(async () => null),
        findMonthlyResultRevisionNotificationFacts: vi.fn(async () => null),
      },
      responsibleManagers: fakes.responsibleManagers,
      userLookup: fakes.userLookup,
      receipts,
    })
    registerPortalNotificationConsumers(consumerRegistry, {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerPortalHealthNotificationConsumer(consumerRegistry, {
      queue: fakes.queue,
      responsibleManagers: fakes.responsibleManagers,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerPropertyNotificationConsumers(consumerRegistry, {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      logger: fakes.logger,
      receipts,
    })
    registerIntegrationNotificationConsumers(consumerRegistry, {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      googleConnectionProperties: {
        findGoogleNotificationAnchor: vi.fn(async () => null),
      },
      logger: fakes.logger,
      receipts,
    })

    expect(() =>
      assertBetaNotificationTriggerMatrix(consumerRegistry.list()),
    ).not.toThrow()
  })
})
