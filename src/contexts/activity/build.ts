import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createRecentActivityRepository } from './infrastructure/recent-activity-repository.drizzle'
import { registerActivityHandlers } from './infrastructure/event-handlers'
import { withCatalogueJobOptions } from '#/shared/jobs/job-policy'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { listRecentActivity } from './queries/list-recent-activity'
import { createDbInboxItemLookupAdapter } from './infrastructure/adapters/db-inbox-item-lookup.adapter'
import { createDbUserLookupAdapter } from './infrastructure/adapters/db-user-lookup.adapter'
import { createActivityDeliveryStore } from './infrastructure/activity-delivery-store'
import { registerActivityOutboxConsumers } from './infrastructure/outbox-consumers'
import { createRecentActivityRecoveryRuntime } from './infrastructure/recent-activity-recovery-runtime'
import type { RecentActivityEntryId } from '#/shared/domain/ids'
import type { OperationalActionHistoryRecordId } from './domain/operational-action-history'
import { createOperationalActionHistoryStore } from './infrastructure/operational-action-history-store'
import { createRecentActivityPrivacyStore } from './infrastructure/recent-activity-privacy-store'
import { redactRecentActivityActorLabels } from './application/use-cases/redact-recent-activity-actor-labels'
import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
  type OperationalHistoryAccessAuthority,
} from './application/use-cases/operational-action-history-access'
import {
  appendOperationalAction,
  assessOperationalActionHistoryRetention,
  getOperationalActionHistoryReadiness,
  placeOperationalActionHistoryLegalHold,
  redactOperationalActionHistorySubject,
  releaseOperationalActionHistoryLegalHold,
} from './application/use-cases/operational-action-history-lifecycle'
import {
  applyRecentActivityVocabularyReconciliation,
  reportRecentActivityVocabulary,
} from './application/use-cases/reconcile-recent-activity-vocabulary'
import type { RecentActivityVocabularyApplyAuthority } from './ports/recent-activity-vocabulary-reconciliation.port'
import { createRecentActivityVocabularyReconciliationStore } from './infrastructure/recent-activity-vocabulary-reconciliation.store'
import { createActivityProjectionRuntime } from './application/activity-projection-runtime'
import { createActivityOrganizationExportContributor } from './infrastructure/adapters/activity-organization-export.adapter'
import { createActivityOrganizationLifecycleContributor } from './infrastructure/adapters/activity-organization-lifecycle.adapter'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  staffPublicApi: StaffPublicApi
  queue: Queue | undefined
  clock: () => Date
  logger: LoggerPort
  idGen: () => RecentActivityEntryId
  operationalHistoryAccessAuthority?: OperationalHistoryAccessAuthority
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
  operationalHistoryHoldIdGen: () => string
  recentActivityVocabularyApplyAuthority?: RecentActivityVocabularyApplyAuthority
}>

export const buildActivityContext = (input: BuildInput) => {
  const repo = createRecentActivityRepository(input.db, input.logger)
  const inboxItemLookup = createDbInboxItemLookupAdapter(input.db)
  const userLookup = createDbUserLookupAdapter(input.db)
  const deliveryStore = createActivityDeliveryStore(input.db)
  const recoveryRuntime = createRecentActivityRecoveryRuntime(input.db, input.logger)
  const privacyStore = createRecentActivityPrivacyStore(input.db)
  const operationalHistoryStore = createOperationalActionHistoryStore(input.db)
  const vocabularyStore = createRecentActivityVocabularyReconciliationStore(input.db)
  const vocabularyAuthority =
    input.recentActivityVocabularyApplyAuthority ??
    ({ authorize: async () => false } as const)
  const operationalHistoryIdGen = input.operationalHistoryIdGen
  const operationalHistoryLifecycle = {
    store: operationalHistoryStore,
    clock: input.clock,
    idGen: operationalHistoryIdGen,
    holdIdGen: input.operationalHistoryHoldIdGen,
  }
  const operationalHistoryAccess = {
    store: operationalHistoryStore,
    accessAuthority:
      input.operationalHistoryAccessAuthority ??
      ({ isCurrentAccountAdmin: async () => false } as const),
    clock: input.clock,
    idGen: operationalHistoryIdGen,
  }
  const listHistory = listOperationalActionHistory(operationalHistoryAccess)
  const exportHistory = exportOperationalActionHistory(operationalHistoryAccess)

  const timeline = getActivityTimeline({
    repo,
    staffPublicApi: input.staffPublicApi,
  })
  const orgActivity = listRecentActivity({
    repo,
    staffPublicApi: input.staffPublicApi,
  })

  // Register per-tag handlers that enqueue BullMQ jobs.
  // BQC-3.6: the queue is wrapped so every project-recent-activity enqueue
  // inherits the catalogue retry policy (attempts/backoff+jitter/timeout).
  if (input.queue) {
    registerActivityHandlers({
      events: input.events,
      queue: withCatalogueJobOptions(input.queue),
      inboxItemLookup,
      logger: input.logger,
    })
  }

  const publicApi = {
    getActivityTimeline: timeline,
    listRecentActivity: orgActivity,
    listOperationalActionHistory: listHistory,
    exportOperationalActionHistory: exportHistory,
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) =>
    registerActivityOutboxConsumers(consumerRegistry, {
      deliveryStore,
      userLookup,
      inboxItemLookup,
      clock: input.clock,
      logger: input.logger,
      idGen: input.idGen,
      operationalHistoryDeliveryStore: operationalHistoryStore,
      operationalHistoryIdGen,
    })

  // ACT-005: projectRecentActivity is NOT constructed here — bootstrap.ts owns the
  // worker-side instantiation (it has the BullMQ job handler). This build
  // function is for the web process (query + handler registration only).
  return {
    publicApi,
    // LIF-01-T8: Activity's Organization Export contribution. It is published
    // as its own named seam rather than through publicApi because the export is
    // an Identity-orchestrated lifecycle capability, not a manager-facing read —
    // a dark capability must not become reachable by being wired here.
    organizationExportContributor: createActivityOrganizationExportContributor(input.db),
    // LIF-01-T12/T13/T14: Activity's Organization lifecycle contribution, on
    // its own named seam for the same reason as the export contributor. Binding
    // it here does NOT make purge reachable — the coordinator still refuses to
    // run without all seventeen contributors plus independently reviewed
    // support authorization, and its worker schedule stays quarantined.
    organizationLifecycleContributor: createActivityOrganizationLifecycleContributor(
      input.db,
    ),
    // ARC-03-T12: Activity owns its projection end to end. The container used
    // to hand bootstrap the recent-activity REPOSITORY so the worker could
    // assemble this itself.
    worker: Object.freeze({
      registerOutboxConsumers,
      ...createActivityProjectionRuntime({
        repo,
        userLookup,
        clock: input.clock,
        logger: input.logger,
        idGen: input.idGen,
      }),
    }),
    internal: {
      repos: {
        recentActivityRepo: repo,
        operationalActionHistoryStore: operationalHistoryStore,
      },
      useCases: {
        getActivityTimeline: timeline,
        listRecentActivity: orgActivity,
        ...recoveryRuntime,
        redactRecentActivityActorLabels: redactRecentActivityActorLabels({
          store: privacyStore,
          clock: input.clock,
        }),
        reportRecentActivityVocabulary: reportRecentActivityVocabulary({
          store: vocabularyStore,
          clock: input.clock,
        }),
        applyRecentActivityVocabularyReconciliation:
          applyRecentActivityVocabularyReconciliation({
            store: vocabularyStore,
            authority: vocabularyAuthority,
            clock: input.clock,
          }),
        listOperationalActionHistory: listHistory,
        exportOperationalActionHistory: exportHistory,
        appendOperationalAction: appendOperationalAction({
          store: operationalHistoryStore,
          clock: input.clock,
          idGen: operationalHistoryIdGen,
        }),
        getOperationalActionHistoryReadiness: getOperationalActionHistoryReadiness({
          store: operationalHistoryStore,
        }),
        assessOperationalActionHistoryRetention: assessOperationalActionHistoryRetention(
          operationalHistoryLifecycle,
        ),
        placeOperationalActionHistoryLegalHold: placeOperationalActionHistoryLegalHold(
          operationalHistoryLifecycle,
        ),
        releaseOperationalActionHistoryLegalHold:
          releaseOperationalActionHistoryLegalHold(operationalHistoryLifecycle),
        redactOperationalActionHistorySubject: redactOperationalActionHistorySubject(
          operationalHistoryLifecycle,
        ),
      },
    },
  } as const
}
