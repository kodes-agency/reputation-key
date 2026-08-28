/**
 * Executable GOA-01 authority inventory.
 *
 * The two pre-beta data families remain readable by future migration tooling,
 * but none is an active product authority. New beta behavior belongs only to
 * Goal Programs and their immutable versions, assignments, and results.
 */

export type GoalAuthorityFamily = 'legacy_goal' | 'governed_goal' | 'goal_program'

export type GoalAuthorityKind = 'mutation' | 'read' | 'job' | 'schedule' | 'ui'

export type GoalAuthorityPosture =
  | 'active'
  | 'not_composed'
  | 'denied_at_entry'
  | 'not_registered'
  | 'not_scheduled'
  | 'not_routed'

export type GoalAuthorityEntry = Readonly<{
  id: string
  family: GoalAuthorityFamily
  kind: GoalAuthorityKind
  source: string
  symbol: string
  betaPosture: GoalAuthorityPosture
  dataDisposition: 'retained' | 'canonical'
}>

const legacy = (
  entry: Omit<GoalAuthorityEntry, 'dataDisposition'>,
): GoalAuthorityEntry => ({ ...entry, dataDisposition: 'retained' })

const active = (
  entry: Omit<GoalAuthorityEntry, 'family' | 'betaPosture' | 'dataDisposition'>,
): GoalAuthorityEntry => ({
  ...entry,
  family: 'goal_program',
  betaPosture: 'active',
  dataDisposition: 'canonical',
})

export const RETAINED_LEGACY_GOAL_AUTHORITY = [
  legacy({
    id: 'legacy-goal.create',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/create-goal.ts',
    symbol: 'createGoal',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.update',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/update-goal.ts',
    symbol: 'updateGoal',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.cancel',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/cancel-goal.ts',
    symbol: 'cancelGoal',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.system-cancel',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/system-cancel-goal.ts',
    symbol: 'systemCancelGoal',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.metric-recorded-consumer',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts',
    symbol: 'onMetricRecorded',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.portal-deleted-consumer',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.ts',
    symbol: 'onPortalDeleted',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.portal-group-deleted-consumer',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/infrastructure/event-handlers/on-portal-group-deleted.ts',
    symbol: 'onPortalGroupDeleted',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.get',
    family: 'legacy_goal',
    kind: 'read',
    source: 'src/contexts/goal/application/use-cases/get-goal.ts',
    symbol: 'getGoal',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.list',
    family: 'legacy_goal',
    kind: 'read',
    source: 'src/contexts/goal/application/use-cases/list-goals.ts',
    symbol: 'listGoals',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.list-for-staff',
    family: 'legacy_goal',
    kind: 'read',
    source: 'src/contexts/goal/application/use-cases/list-staff-goals.ts',
    symbol: 'listStaffGoals',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'legacy-goal.staff-server-read',
    family: 'legacy_goal',
    kind: 'read',
    source: 'src/contexts/goal/server/staff-goals.ts',
    symbol: 'listStaffGoals',
    betaPosture: 'denied_at_entry',
  }),
  legacy({
    id: 'legacy-goal.spawn-recurring-job',
    family: 'legacy_goal',
    kind: 'job',
    source: 'src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts',
    symbol: 'createSpawnRecurringInstancesHandler',
    betaPosture: 'not_registered',
  }),
  legacy({
    id: 'legacy-goal.reconcile-progress-job',
    family: 'legacy_goal',
    kind: 'job',
    source: 'src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts',
    symbol: 'createReconcileGoalProgressHandler',
    betaPosture: 'not_registered',
  }),
  legacy({
    id: 'legacy-goal.spawn-recurring-schedule',
    family: 'legacy_goal',
    kind: 'schedule',
    source: 'src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts',
    symbol: 'spawn-recurring-instances-recurring',
    betaPosture: 'not_scheduled',
  }),
  legacy({
    id: 'legacy-goal.reconcile-progress-schedule',
    family: 'legacy_goal',
    kind: 'schedule',
    source: 'src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts',
    symbol: 'reconcile-goal-progress-recurring',
    betaPosture: 'not_scheduled',
  }),
  legacy({
    id: 'legacy-goal.scenario-fixture-writer',
    family: 'legacy_goal',
    kind: 'mutation',
    source: 'src/shared/testing/scenario/builder.server.ts',
    symbol: 'createGoals',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.create',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.create',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.revise',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.revise',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.change-status',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.changeStatus',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.evaluate',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.evaluate',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.correct',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.correct',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.apply-timezone-change',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.applyTimezoneChange',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.get',
    family: 'governed_goal',
    kind: 'read',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.get',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.list',
    family: 'governed_goal',
    kind: 'read',
    source: 'src/contexts/goal/application/use-cases/governed-goals.ts',
    symbol: 'createGovernedGoalService.list',
    betaPosture: 'not_composed',
  }),
  legacy({
    id: 'governed-goal.close-job',
    family: 'governed_goal',
    kind: 'job',
    source: 'src/contexts/goal/infrastructure/jobs/governed-goal.jobs.ts',
    symbol: 'runGovernedGoalCloseSchedule',
    betaPosture: 'not_registered',
  }),
  legacy({
    id: 'governed-goal.refresh-job',
    family: 'governed_goal',
    kind: 'job',
    source: 'src/contexts/goal/infrastructure/jobs/governed-goal.jobs.ts',
    symbol: 'refreshGovernedGoalsFromReading',
    betaPosture: 'not_registered',
  }),
  legacy({
    id: 'governed-goal.close-schedule',
    family: 'governed_goal',
    kind: 'schedule',
    source: 'src/contexts/goal/infrastructure/jobs/governed-goal.jobs.ts',
    symbol: 'governed-goal-close-recurring',
    betaPosture: 'not_scheduled',
  }),
  legacy({
    id: 'governed-goal.refresh-schedule',
    family: 'governed_goal',
    kind: 'schedule',
    source: 'src/contexts/goal/infrastructure/jobs/governed-goal.jobs.ts',
    symbol: 'governed-goal-refresh-recurring',
    betaPosture: 'not_scheduled',
  }),
  legacy({
    id: 'governed-goal.e2e-fixture-writer',
    family: 'governed_goal',
    kind: 'mutation',
    source: 'scripts/seed-e2e-user.ts',
    symbol: 'ensureGoalAndRecognitionFixtures',
    betaPosture: 'not_composed',
  }),
] as const satisfies readonly GoalAuthorityEntry[]

export const ACTIVE_GOAL_PROGRAM_AUTHORITY = [
  active({
    id: 'goal-program.create',
    kind: 'mutation',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'createGoalProgram',
  }),
  active({
    id: 'goal-program.revise',
    kind: 'mutation',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'reviseGoalProgram',
  }),
  active({
    id: 'goal-program.change-assignments',
    kind: 'mutation',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'changeGoalProgramAssignments',
  }),
  active({
    id: 'goal-program.change-status',
    kind: 'mutation',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'changeGoalProgramStatus',
  }),
  active({
    id: 'goal-program.get',
    kind: 'read',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'getGoalProgram',
  }),
  active({
    id: 'goal-program.list',
    kind: 'read',
    source: 'src/contexts/goal/server/goal-programs.ts',
    symbol: 'listGoalPrograms',
  }),
  active({
    id: 'goal-program.property-attention-read',
    kind: 'read',
    source: 'src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts',
    symbol: 'createAttentionSignalsAdapter.getAttentionCounts',
  }),
  active({
    id: 'goal-program.fleet-attention-read',
    kind: 'read',
    source:
      'src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts',
    symbol: 'createFleetOverviewProjectionAdapter.read',
  }),
  active({
    id: 'goal-program.notification-close-facts-read',
    kind: 'read',
    source:
      'src/contexts/goal/infrastructure/adapters/monthly-result-notification-facts.lookup.ts',
    symbol: 'findMonthlyResultNotificationFacts',
  }),
  active({
    id: 'goal-program.notification-revision-facts-read',
    kind: 'read',
    source:
      'src/contexts/goal/infrastructure/adapters/monthly-result-notification-facts.lookup.ts',
    symbol: 'findMonthlyResultRevisionNotificationFacts',
  }),
  active({
    id: 'goal-program.metric-correction',
    kind: 'mutation',
    source: 'src/contexts/goal/infrastructure/metric-correction-outbox-consumers.ts',
    symbol: 'registerGoalMetricCorrectionConsumer',
  }),
  active({
    id: 'goal-program.maintain-job',
    kind: 'job',
    source: 'src/contexts/goal/infrastructure/jobs/goal-program-maintenance.job.ts',
    symbol: 'goal-program.maintain',
  }),
  active({
    id: 'goal-program.maintain-schedule',
    kind: 'schedule',
    source: 'src/shared/governance/event-job-catalogue.ts',
    symbol: 'goal-program.maintain-recurring',
  }),
  active({
    id: 'goal-program.manager-ui',
    kind: 'ui',
    source: 'src/routes/_authenticated/properties/$propertyId/goals/index.tsx',
    symbol: '/properties/$propertyId/goals',
  }),
] as const satisfies readonly GoalAuthorityEntry[]

export type RetainedLegacyGoalAuthorityId =
  (typeof RETAINED_LEGACY_GOAL_AUTHORITY)[number]['id']

export class LegacyGoalAuthorityError extends Error {
  readonly code = 'legacy_goal_authority_disabled' as const

  constructor(readonly entryId: RetainedLegacyGoalAuthorityId) {
    super('This historical Goal entry is unavailable in the beta runtime')
    this.name = 'LegacyGoalAuthorityError'
  }
}

/** Hard boundary for a retained direct declaration that cannot be deleted yet. */
export function denyLegacyGoalBetaEntry(entryId: RetainedLegacyGoalAuthorityId): never {
  throw new LegacyGoalAuthorityError(entryId)
}

const allowedLegacyPosture: Readonly<Record<GoalAuthorityKind, GoalAuthorityPosture>> = {
  mutation: 'not_composed',
  read: 'not_composed',
  job: 'not_registered',
  schedule: 'not_scheduled',
  ui: 'not_routed',
}

export function goalBetaAuthorityViolations(
  entries: readonly GoalAuthorityEntry[] = [
    ...RETAINED_LEGACY_GOAL_AUTHORITY,
    ...ACTIVE_GOAL_PROGRAM_AUTHORITY,
  ],
): readonly string[] {
  const violations: string[] = []
  const seen = new Set<string>()
  const activeFamilies = new Set<GoalAuthorityFamily>()

  for (const entry of entries) {
    if (seen.has(entry.id)) violations.push(`${entry.id}: duplicate authority entry`)
    seen.add(entry.id)

    if (entry.betaPosture === 'active') activeFamilies.add(entry.family)
    if (entry.family === 'goal_program') {
      if (entry.betaPosture !== 'active' || entry.dataDisposition !== 'canonical') {
        violations.push(`${entry.id}: canonical Goal Program entry must be active`)
      }
      continue
    }

    if (entry.betaPosture === 'active') {
      violations.push(`${entry.id}: retained legacy entry cannot be beta-active`)
    }
    if (entry.dataDisposition !== 'retained') {
      violations.push(`${entry.id}: retained historical data must remain retained`)
    }
    const expectedPosture = allowedLegacyPosture[entry.kind]
    if (
      entry.betaPosture !== expectedPosture &&
      !(entry.kind === 'read' && entry.betaPosture === 'denied_at_entry')
    ) {
      violations.push(
        `${entry.id}: ${entry.kind} must be ${expectedPosture}${entry.kind === 'read' ? ' or denied_at_entry' : ''}`,
      )
    }
  }

  if (activeFamilies.size !== 1 || !activeFamilies.has('goal_program')) {
    violations.push('GoalProgram must be the sole beta-active Goal authority')
  }
  return violations
}
