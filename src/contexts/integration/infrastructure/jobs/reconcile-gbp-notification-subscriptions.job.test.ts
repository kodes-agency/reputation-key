import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { createOperationalSchedulerPlan } from '#/shared/jobs/operational-catalogue'
import { organizationId } from '#/shared/domain/ids'
import type {
  GbpNotificationReconciliationSummary,
  ReconcileGbpNotificationSubscriptions,
} from '../../application/use-cases/reconcile-gbp-notification-subscriptions'
import {
  createReconcileGbpNotificationSubscriptionsHandler,
  JOB_NAME,
  RUN_BUDGET_MS,
} from './reconcile-gbp-notification-subscriptions.job'

const MODULE_PATH =
  'src/contexts/integration/infrastructure/jobs/reconcile-gbp-notification-subscriptions.job.ts'
const ORG = organizationId('org-reconcile-job')
const ACTION = 'system:integration.gbp_subscription_reconcile'

const NOW_MS = 1_790_000_000_000

const reconciled = (
  overrides: Partial<
    Extract<GbpNotificationReconciliationSummary, { status: 'reconciled' }>
  > = {},
): GbpNotificationReconciliationSummary => ({
  status: 'reconciled',
  organizations: 1,
  organizationsDenied: 0,
  organizationsFailed: 0,
  organizationsDeferred: 0,
  connections: 2,
  candidates: 1,
  connectionOutcomes: { already_subscribed: 1, skipped_inactive: 1 },
  unsettledConnections: 0,
  accounts: { subscribed: 0, alreadySubscribed: 3, failed: 0, failureCodes: {} },
  retry: false,
  ...overrides,
})

const setup = (summary: GbpNotificationReconciliationSummary) => {
  const reconcile = vi.fn<ReconcileGbpNotificationSubscriptions>(async () => summary)
  const authorizeScope = vi.fn(async () => true)
  const logger = { info: vi.fn(), warn: vi.fn() }
  const handler = createReconcileGbpNotificationSubscriptionsHandler({
    reconcile,
    authorizeScope,
    nowMs: () => NOW_MS,
    logger,
  })
  return { handler, reconcile, authorizeScope, logger }
}

const tick = { data: { organizationId: 'must-not-be-used' } } as unknown as Job

describe('reconcile-gbp-notification-subscriptions job', () => {
  it('logs one content-free summary line per run', async () => {
    const { handler, logger } = setup(reconciled())

    await handler(tick)

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      {
        job: JOB_NAME,
        organizations: 1,
        organizationsDenied: 0,
        organizationsFailed: 0,
        organizationsDeferred: 0,
        connections: 2,
        candidates: 1,
        connectionOutcomes: { already_subscribed: 1, skipped_inactive: 1 },
        unsettledConnections: 0,
        accountsSubscribed: 0,
        accountsAlreadySubscribed: 3,
        accountsFailed: 0,
        failureCodes: {},
      },
      'GBP notification subscriptions reconciled',
    )
  })

  it.each([
    [
      'an account failed',
      {
        connectionOutcomes: { provider_failed: 1 },
        unsettledConnections: 1,
        accounts: {
          subscribed: 1,
          alreadySubscribed: 0,
          failed: 1,
          failureCodes: { provider_403: 1 },
        },
      },
    ],
    [
      'a connection could not be authorized',
      { connectionOutcomes: { authorization_unavailable: 1 }, unsettledConnections: 1 },
    ],
    ['organizations were left for the next run', { organizationsDeferred: 2 }],
  ] as const)('warns when %s', async (_label, overrides) => {
    const { handler, logger } = setup(reconciled(overrides))

    await handler(tick)

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: JOB_NAME }),
      'GBP notification subscriptions reconciled',
    )
  })

  it('logs, then fails the run for a queue retry, on a transient failure', async () => {
    const { handler, logger } = setup(
      reconciled({
        connectionOutcomes: { provider_failed: 1 },
        unsettledConnections: 1,
        accounts: {
          subscribed: 0,
          alreadySubscribed: 0,
          failed: 1,
          failureCodes: { coordination_unavailable: 1 },
        },
        retry: true,
      }),
    )

    await expect(handler(tick)).rejects.toThrow(
      'GBP notification subscription reconciliation incomplete — retrying',
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failureCodes: { coordination_unavailable: 1 } }),
      'GBP notification subscriptions reconciled',
    )
  })

  it('stops starting organizations well inside the job timeout', async () => {
    const { handler, reconcile } = setup(reconciled())

    await handler(tick)

    const [{ deadlineAtMs }] = reconcile.mock.calls[0]!
    const timeoutMs = JOB_FAMILY_ROWS.find((row) => row.jobName === JOB_NAME)?.timeoutMs
    expect(deadlineAtMs).toBe(NOW_MS + RUN_BUDGET_MS)
    expect(RUN_BUDGET_MS).toBeLessThanOrEqual((timeoutMs ?? 0) - 60_000)
  })

  it('says why it did nothing when no topic is configured', async () => {
    const { handler, logger } = setup({ status: 'topic_unset' })

    await handler(tick)

    expect(logger.info).toHaveBeenCalledWith(
      { job: JOB_NAME, envVar: 'GBP_PUBSUB_TOPIC' },
      'GBP notification subscription reconciliation skipped — no Pub/Sub topic configured',
    )
  })

  it('authorizes each organization through current policy, never the job payload', async () => {
    const { handler, reconcile, authorizeScope } = setup(reconciled())

    await handler(tick)
    const [{ authorizeOrganization }] = reconcile.mock.calls[0]!
    await authorizeOrganization(ORG)

    expect(authorizeScope).toHaveBeenCalledWith(ORG)
    expect(authorizeScope).not.toHaveBeenCalledWith('must-not-be-used')
  })

  it('is one capability-gated daily background family the catalogue pins to this module', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.processor === MODULE_PATH)).toEqual([
      expect.objectContaining({
        jobName: JOB_NAME,
        queue: 'background',
        capability: 'property.connect_gbp',
        action: ACTION,
        schedule: 'every:86400000',
        registration: 'enabled',
        retryAttempts: 3,
        retryBackoff: 'exponential:60000',
      }),
    ])
  })

  // Tenant-cross: the schedule may only enumerate; every organization is
  // decided again (authorizeScope). External effect: policy is read fresh.
  it('enters as a tenant-cross, external-effect job and schedule', () => {
    const rows = ENTRY_POINT_CATALOGUE.filter((row) => row.action === ACTION)

    expect(rows).toEqual([
      {
        kind: 'job',
        name: JOB_NAME,
        action: ACTION,
        capability: 'property.connect_gbp',
        resourceScope: 'tenant_cross',
        externalEffect: true,
      },
      {
        kind: 'schedule',
        name: `${JOB_NAME}-recurring`,
        action: ACTION,
        capability: 'property.connect_gbp',
        resourceScope: 'tenant_cross',
        externalEffect: true,
      },
    ])
  })

  // No offset: BullMQ runs an interval scheduler the moment it is first
  // installed, so the deploy that introduces it repairs the accounts at once.
  it('is installed as a daily interval that first fires on install', () => {
    const scheduler = createOperationalSchedulerPlan().desired.find(
      (entry) => entry.jobName === JOB_NAME,
    )

    expect(scheduler).toMatchObject({
      schedulerId: `${JOB_NAME}-recurring`,
      repeat: { every: 86_400_000 },
    })
    expect(scheduler?.repeat).not.toHaveProperty('offset')
  })
})
