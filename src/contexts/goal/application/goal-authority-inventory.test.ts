import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTIVE_GOAL_PROGRAM_AUTHORITY,
  LegacyGoalAuthorityError,
  RETAINED_LEGACY_GOAL_AUTHORITY,
  denyLegacyGoalBetaEntry,
  goalBetaAuthorityViolations,
  type GoalAuthorityEntry,
} from './goal-authority-inventory'

function readTypeScriptTree(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return [readTypeScriptTree(path)]
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? [readFileSync(path, 'utf8')]
        : []
    })
    .join('\n')
}

describe('Goal beta authority inventory', () => {
  it('accounts for every retained legacy mutation, read, job, schedule, and UI entry', () => {
    expect(RETAINED_LEGACY_GOAL_AUTHORITY.map(({ id }) => id)).toEqual([
      'legacy-goal.create',
      'legacy-goal.update',
      'legacy-goal.cancel',
      'legacy-goal.system-cancel',
      'legacy-goal.metric-recorded-consumer',
      'legacy-goal.portal-deleted-consumer',
      'legacy-goal.portal-group-deleted-consumer',
      'legacy-goal.get',
      'legacy-goal.list',
      'legacy-goal.list-for-staff',
      'legacy-goal.staff-server-read',
      'legacy-goal.spawn-recurring-job',
      'legacy-goal.reconcile-progress-job',
      'legacy-goal.spawn-recurring-schedule',
      'legacy-goal.reconcile-progress-schedule',
      'legacy-goal.scenario-fixture-writer',
      'governed-goal.create',
      'governed-goal.revise',
      'governed-goal.change-status',
      'governed-goal.evaluate',
      'governed-goal.correct',
      'governed-goal.apply-timezone-change',
      'governed-goal.get',
      'governed-goal.list',
      'governed-goal.close-job',
      'governed-goal.refresh-job',
      'governed-goal.close-schedule',
      'governed-goal.refresh-schedule',
      'governed-goal.e2e-fixture-writer',
    ])
    expect(new Set(RETAINED_LEGACY_GOAL_AUTHORITY.map(({ kind }) => kind))).toEqual(
      new Set(['mutation', 'read', 'job', 'schedule']),
    )
  })

  it('has one active family and preserves every retained historical data family', () => {
    expect(goalBetaAuthorityViolations()).toEqual([])
    expect(new Set(ACTIVE_GOAL_PROGRAM_AUTHORITY.map(({ family }) => family))).toEqual(
      new Set(['goal_program']),
    )
    expect(
      RETAINED_LEGACY_GOAL_AUTHORITY.every(
        ({ betaPosture, dataDisposition }) =>
          betaPosture !== 'active' && dataDisposition === 'retained',
      ),
    ).toBe(true)
  })

  it('fails closed when a retained legacy mutation is presented as active', () => {
    const rogue = {
      ...RETAINED_LEGACY_GOAL_AUTHORITY[0],
      betaPosture: 'active',
    } as GoalAuthorityEntry

    expect(
      goalBetaAuthorityViolations([
        rogue,
        ...RETAINED_LEGACY_GOAL_AUTHORITY.slice(1),
        ...ACTIVE_GOAL_PROGRAM_AUTHORITY,
      ]),
    ).toContain('legacy-goal.create: retained legacy entry cannot be beta-active')
  })

  it('denies a direct legacy network entry before it can read historical rows', () => {
    expect(() => denyLegacyGoalBetaEntry('legacy-goal.staff-server-read')).toThrow(
      LegacyGoalAuthorityError,
    )
    try {
      denyLegacyGoalBetaEntry('legacy-goal.staff-server-read')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'legacy_goal_authority_disabled',
        entryId: 'legacy-goal.staff-server-read',
      })
    }
  })

  it('proves runtime composition and Dashboard reads use only GoalProgram authority', () => {
    const sources = {
      build: readFileSync('src/contexts/goal/build.ts', 'utf8'),
      goalPrograms: readFileSync(
        'src/contexts/goal/application/use-cases/goal-programs.ts',
        'utf8',
      ),
      goalProgramServer: readFileSync(
        'src/contexts/goal/server/goal-programs.ts',
        'utf8',
      ),
      composition: readFileSync('src/composition.ts', 'utf8'),
      goalConsumers: readFileSync(
        'src/contexts/goal/infrastructure/event-handlers/index.ts',
        'utf8',
      ),
      attention: readFileSync(
        'src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts',
        'utf8',
      ),
      fleet: readFileSync(
        'src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts',
        'utf8',
      ),
      bootstrap: readFileSync('src/bootstrap.ts', 'utf8'),
      eventJobs: readFileSync('src/shared/governance/event-job-catalogue.ts', 'utf8'),
      entryPoints: readFileSync('src/shared/governance/entry-point-catalogue.ts', 'utf8'),
      routes: readTypeScriptTree('src/routes'),
    }

    expect(sources.build).not.toMatch(
      /createGoalRepository|createGovernedGoalRepository|createGovernedGoalService|registerGoalEventHandlers/,
    )
    for (const canonicalSource of [
      sources.build,
      sources.goalPrograms,
      sources.goalProgramServer,
    ]) {
      expect(canonicalSource).not.toContain('/governed-goals')
    }
    expect(sources.composition).not.toContain('goalRepo: goal.internal.repos.goalRepo')
    expect(sources.composition).not.toMatch(
      /goal\.internal\.useCases\.(?:createGoal|updateGoal|cancelGoal|listStaffGoals)/,
    )
    expect(sources.goalConsumers).not.toMatch(/\.on\(['"]portal(?:_group)?\.deleted/)
    expect(`${sources.entryPoints}\n${sources.eventJobs}`).not.toContain(
      'goal.event-handlers',
    )
    expect(`${sources.bootstrap}\n${sources.eventJobs}`).not.toMatch(
      /spawn-recurring-instances|reconcile-goal-progress|governed-goal-(?:close|refresh)/,
    )
    expect(sources.routes).not.toMatch(/StaffGoalSummary|GoalProgressBar/)

    const progressRoute = readFileSync('src/routes/_authenticated/progress.tsx', 'utf8')
    expect(progressRoute).not.toMatch(/listGoalPrograms|StaffGoalList|goalKeys/u)
    expect(progressRoute).toContain("to: '/home'")

    expect(
      [
        'src/components/features/staff/staff-goal-list.tsx',
        'src/components/features/staff/staff-goal-summary.tsx',
        'src/components/goals/goal-progress-bar.tsx',
        'src/components/goals/goal-progress-ring-model.ts',
        'src/components/goals/goal-progress-ring.tsx',
        'src/components/goals/goal-progress-ring.stories.tsx',
        'src/components/goals/goal-trajectory-graph.tsx',
        'src/components/goals/goal-trajectory-graph.stories.tsx',
      ].filter(existsSync),
    ).toEqual([])

    expect(sources.attention).toContain('goalMonthlyResults')
    expect(sources.attention).toContain('goalProgramVersions')
    expect(sources.fleet).toContain('goal_monthly_results')
    expect(sources.fleet).toContain('goal_program_versions')

    for (const projection of [sources.attention, sources.fleet]) {
      expect(projection).not.toMatch(
        /goalProgress|goal_progress|goalDefinitions|goal_definitions|goalDefinitionVersions|goal_definition_versions|goalPeriods|goal_periods|goalEvaluations|goal_evaluations/,
      )
    }
  })
})
