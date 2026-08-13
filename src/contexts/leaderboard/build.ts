import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Clock } from '#/shared/domain/clock'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import type { OutboxRepository } from '#/shared/outbox'
import { createRecognitionRepository } from './infrastructure/repositories/recognition.repository'
import { registerRecognitionEventHandlers } from './infrastructure/event-handlers'
import {
  createRecognitionUseCases,
  type RecognitionUseCases,
} from './application/use-cases/governed-recognition'
import type { RecognitionRepository } from './application/ports/recognition.repository'
import type {
  PropertyFactsPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'

export type LeaderboardContextApi = Readonly<{
  publicApi: Readonly<{
    recognition: Pick<
      RecognitionUseCases,
      'getSettings' | 'activate' | 'deactivate' | 'getBoard'
    >
  }>
  internal: Readonly<{
    repos: Readonly<{ recognitionRepo: RecognitionRepository }>
    useCases: Readonly<{
      reconcileRecognition: RecognitionUseCases['reconcileProperty']
      reconcileAllRecognition: RecognitionUseCases['reconcileAll']
      listRecognitionScopes: RecognitionUseCases['listActiveScopes']
    }>
  }>
}>

export type BuildLeaderboardContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: OutboxRepository
  clock: Clock
  propertyApi: Pick<PropertyPublicApi, 'propertyExists'> & PropertyFactsPublicApi
  authorizeBoardReconciliationScope: ScheduledScopeAuthorizer
  authorizeAwardReconciliationScope: ScheduledScopeAuthorizer
}>

export function buildLeaderboardContext(
  deps: BuildLeaderboardContextDeps,
): LeaderboardContextApi {
  const recognitionRepo = createRecognitionRepository({
    db: deps.db,
    clock: deps.clock,
    propertyApi: deps.propertyApi,
    authorizeBoardScope: deps.authorizeBoardReconciliationScope,
    authorizeAwardScope: deps.authorizeAwardReconciliationScope,
  })
  const recognitionUseCases = createRecognitionUseCases(recognitionRepo)

  registerRecognitionEventHandlers({
    eventBus: deps.events,
    reconcileProperty: recognitionUseCases.reconcileProperty,
  })

  return {
    publicApi: {
      recognition: {
        getSettings: recognitionUseCases.getSettings,
        activate: recognitionUseCases.activate,
        deactivate: recognitionUseCases.deactivate,
        getBoard: recognitionUseCases.getBoard,
      },
    },
    internal: {
      repos: { recognitionRepo },
      useCases: {
        reconcileRecognition: recognitionUseCases.reconcileProperty,
        reconcileAllRecognition: recognitionUseCases.reconcileAll,
        listRecognitionScopes: recognitionUseCases.listActiveScopes,
      },
    },
  }
}
