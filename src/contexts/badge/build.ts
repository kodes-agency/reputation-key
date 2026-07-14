// Badge context — build function.
// Per architecture: contexts define ports; composition root wires repositories and cross-context adapters.
// Event handlers are registered at build time so every process (web server + worker) handles events.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import { createBadgeRepository } from './infrastructure/repositories/badge.repository'
import { seedBadgeDefinitions } from './application/use-cases/seed-badge-definitions'
import { evaluateBadgeForTarget } from './application/use-cases/evaluate-badge-for-target'
import { reconcileBadgeDefinitions } from './application/use-cases/reconcile-badge-definitions'
import { setOrganizationBadgeEnablement } from './application/use-cases/set-organization-badge-enablement'
import { registerBadgeEventHandlers } from './infrastructure/event-handlers'
import type { BadgeRepository } from './application/ports/badge.repository'
import type {
  OrganizationBadgeEnablement,
  BadgeDefinition,
  BadgeEvaluationResult,
} from './domain/types'
import type {
  EvaluateBadgeForTargetInput,
  ReconcileBadgeDefinitionsInput,
  ReconcileBadgeDefinitionsResult,
} from './application/public-api'
import { badgeId, type BadgeId, type OrganizationId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import type { AuthContext } from '#/shared/domain/auth-context'

export type BadgeContextApi = Readonly<{
  publicApi: Readonly<{
    getStaffVisibleBadges: BadgeRepository['listStaffAwards']
    getVisibleTargetBadges: BadgeRepository['listTargetAwards']
    getOrganizationBadgeDefinitions: BadgeRepository['listDefinitionsWithEnablement']
    setOrganizationBadgeEnablement: (
      ctx: AuthContext,
      input: Readonly<{
        organizationId: OrganizationId
        badgeDefinitionId: BadgeId
        enabled: boolean
      }>,
    ) => Promise<OrganizationBadgeEnablement>
    resolveStaffVisibility: BadgeRepository['resolveStaffVisibility']
  }>
  internal: Readonly<{
    repos: Readonly<{ badgeRepo: BadgeRepository }>
    useCases: Readonly<{
      seedBadgeDefinitions: () => Promise<ReadonlyArray<BadgeDefinition>>
      evaluateBadgeForTarget: (
        input: EvaluateBadgeForTargetInput,
      ) => Promise<ReadonlyArray<BadgeEvaluationResult>>
      reconcileBadgeDefinitions: (
        input: ReconcileBadgeDefinitionsInput,
      ) => Promise<ReconcileBadgeDefinitionsResult>
      setOrganizationBadgeEnablement: (
        input: Readonly<{
          organizationId: OrganizationId
          badgeDefinitionId: BadgeId
          enabled: boolean
        }>,
        ctx: AuthContext,
      ) => Promise<OrganizationBadgeEnablement>
    }>
  }>
}>

export type BuildBadgeContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox/infrastructure/outbox-repository').OutboxRepository
  clock: () => Date
  metricApi: MetricPublicApi
}>

export const buildBadgeContext = (deps: BuildBadgeContextDeps): BadgeContextApi => {
  const badgeRepo = createBadgeRepository(deps.db, deps.clock)
  const evaluate = evaluateBadgeForTarget({
    badgeRepo,
    metricApi: deps.metricApi,
    events: deps.events,
    clock: deps.clock,
    idGen: () => badgeId(randomUUID()),
  })
  const setEnablement = setOrganizationBadgeEnablement({ badgeRepo })

  registerBadgeEventHandlers({
    eventBus: deps.events,
    evaluateBadgeForTarget: evaluate,
  })

  return {
    publicApi: {
      getStaffVisibleBadges: badgeRepo.listStaffAwards,
      getOrganizationBadgeDefinitions: badgeRepo.listDefinitionsWithEnablement,
      getVisibleTargetBadges: badgeRepo.listTargetAwards,
      setOrganizationBadgeEnablement: (ctx, input) => setEnablement(input, ctx),
      resolveStaffVisibility: badgeRepo.resolveStaffVisibility,
    },
    internal: {
      repos: { badgeRepo },
      useCases: {
        seedBadgeDefinitions: seedBadgeDefinitions({ badgeRepo }),
        evaluateBadgeForTarget: evaluate,
        reconcileBadgeDefinitions: reconcileBadgeDefinitions({
          badgeRepo,
          metricApi: deps.metricApi,
          events: deps.events,
          clock: deps.clock,
          idGen: () => badgeId(randomUUID()),
        }),
        setOrganizationBadgeEnablement: setEnablement,
      },
    },
  }
}
