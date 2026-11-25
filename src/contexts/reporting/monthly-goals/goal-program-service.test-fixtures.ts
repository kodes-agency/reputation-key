// Shared harness of the Goal Program service suites against PostgreSQL.
//
// Monthly results cannot be deleted, so each suite runs every test in a
// savepoint of one held transaction that is rolled back. Only the ports that
// are not persistence (policy, metric reads, Property facts) are stand-ins.
import type { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../readings/contracts'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './goal-program-repository.server'
import { readGoalMetricSourceHead } from '../readings/goal-metric-source-head.server'
import { createGoalProgramService } from './goal-programs.server'
import {
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from '../application/use-cases/goal-program-shared'

export const ORGANIZATION_ID = 'org-1'
export const PROPERTY_ID = '00000000-0000-4000-8000-00000000a001'
export const GROUP_ID = '00000000-0000-4000-8000-00000000c001'
/** Portals 1 to 3 of the Property. */
export const portalUuid = (n: number) =>
  `00000000-0000-4000-8000-${String(0xb000 + n).padStart(12, '0')}`
export const PORTAL_IDS = [1, 2, 3].map(portalUuid)

export const actor: GoalActor = {
  organizationId: ORGANIZATION_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
}

/** Every table that references goal_programs, directly or through its children. */
const FOREIGN_GOAL_TABLES_CHILDREN_FIRST = [
  'goal_result_revisions',
  'goal_month_target_changes',
  'goal_monthly_results',
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
]

export type ScenarioTransaction = Readonly<{
  client: () => Client
  db: () => Database
}>

/**
 * Holds one transaction for the suite and runs `seed` inside a savepoint
 * before each test; the savepoint is rolled back after it.
 */
export function useScenarioTransaction(
  seed: (client: Client) => Promise<void>,
): ScenarioTransaction {
  let held: HeldTransaction | undefined

  beforeAll(async () => {
    held = await holdTransaction()
  })
  afterAll(async () => {
    await held?.rollBack()
  })
  beforeEach(async () => {
    await held!.client.query('SAVEPOINT scenario')
    await seed(held!.client)
  })
  afterEach(async () => {
    await held!.client.query('ROLLBACK TO SAVEPOINT scenario')
  })

  return { client: () => held!.client, db: () => held!.db }
}

/** The Property, three Portals and a Portal group the Program suites share. */
async function seedGoalProgramsScenario(client: Client) {
  // Maintenance reads every Program in the database, and other suites commit
  // theirs. Their rows are gone for this scenario only: the savepoint restores them.
  // Their dependent rows go first, in foreign-key order. Monthly results have a
  // delete guard, so it is off for the cleanup; the switch is transactional.
  await client.query(
    'ALTER TABLE goal_monthly_results DISABLE TRIGGER goal_monthly_results_guard',
  )
  for (const table of FOREIGN_GOAL_TABLES_CHILDREN_FIRST) {
    await client.query(`DELETE FROM ${table} WHERE organization_id <> $1`, [
      ORGANIZATION_ID,
    ])
  }
  await client.query(
    'ALTER TABLE goal_monthly_results ENABLE TRIGGER goal_monthly_results_guard',
  )
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Goal Property', 'goal-programs-property', 'UTC')`,
    [PROPERTY_ID, ORGANIZATION_ID],
  )
  for (const [index, portalId] of PORTAL_IDS.entries()) {
    await client.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, $5, $5)`,
      [
        portalId,
        ORGANIZATION_ID,
        PROPERTY_ID,
        PROPERTY_ID,
        `goal-programs-portal-${index + 1}`,
      ],
    )
  }
  await client.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, 'Goal group')`,
    [GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
}

/** The scenario of the Goal Program service suites, with its service wiring. */
export function useGoalProgramsScenario() {
  const scenario = useScenarioTransaction(seedGoalProgramsScenario)
  return {
    ...scenario,
    setup: (initialNow?: Date) => createGoalProgramHarness(scenario.db(), initialNow),
    /** Every version of a Program as stored, including the ones a change replaced. */
    versionWindows: (programId: string) => versionWindows(scenario.client(), programId),
  }
}

async function versionWindows(client: Client, programId: string) {
  const found = await client.query<{
    version: number
    effectiveFrom: Date
    effectiveTo: Date | null
  }>(
    `SELECT version, effective_from AS "effectiveFrom", effective_to AS "effectiveTo"
       FROM goal_program_versions WHERE program_id = $1 ORDER BY version`,
    [programId],
  )
  return found.rows.map((row) => [row.version, row.effectiveFrom, row.effectiveTo])
}

export function createGoalProgramHarness(
  db: Database,
  initialNow = new Date('2026-03-01T00:00:00.000Z'),
) {
  let id = 0
  let now = initialNow
  let programId: string | null = null
  const real = createGoalProgramRepository(db)
  const repository = {
    ...real,
    create: vi.fn<typeof real.create>(async (input) => {
      const outcome = await real.create(input)
      if (outcome === 'created') programId = input.bundle.program.id
      return outcome
    }),
    get: vi.fn(real.get),
    list: vi.fn(real.list),
    listOperational: vi.fn(real.listOperational),
    changeStatus: vi.fn(real.changeStatus),
    revise: vi.fn(real.revise),
    answerCheckIn: vi.fn(real.answerCheckIn),
    findAssignmentConflicts: vi.fn(real.findAssignmentConflicts),
    changeMonthTarget: vi.fn(real.changeMonthTarget),
    activate: vi.fn(real.activate),
    appendResults: vi.fn(real.appendResults),
    listDueResults: vi.fn(real.listDueResults),
    getDueResult: vi.fn(real.getDueResult),
    getProgram: vi.fn(real.getProgram),
    getAssignment: vi.fn(real.getAssignment),
    getVersion: vi.fn(real.getVersion),
    updateResult: vi.fn<typeof real.updateResult>(async (input) =>
      real.updateResult({
        ...input,
        // The metric stand-in reads no source head; closure needs the stored one.
        sourceHead:
          input.sourceHead ??
          (await readGoalMetricSourceHead(
            db,
            {
              ...input.result,
              definitionVersionId: (await real.getVersion(
                input.result.organizationId,
                input.result.propertyId,
                input.result.programVersionId,
              ))!.metricDefinitionVersionId,
            },
            ['guest.rating.submitted', 'guest.rating.retracted'],
          )),
      }),
    ),
    getClosedResult: vi.fn(real.getClosedResult),
    appendResultRevision: vi.fn(real.appendResultRevision),
    findClosedResultIdsForMetricImpact: vi.fn(real.findClosedResultIdsForMetricImpact),
  } satisfies Record<keyof typeof real, unknown>
  const metrics: GoalMetricReadPort = {
    queryGoalMetric: vi.fn<GoalMetricReadPort['queryGoalMetric']>(async (query) => ({
      definitionVersionId: query.definitionVersionId,
      metricKey:
        query.definitionVersionId === METRIC_VERSION_IDS.qualifiedScanGoal
          ? 'portal.qualified_scan'
          : 'portal.rating_count',
      state: 'updating' as const,
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })),
    getApprovedGoalVersion: vi.fn(async (versionId) => findMetricVersionById(versionId)),
  }
  const policy: GoalExecutionPolicy = { authorize: vi.fn(async () => undefined) }
  const subjects: GoalProgramSubjectReader = {
    ratingSubjectsSkipPrivateRating: vi.fn(async () => false),
    staffTargetProblem: vi.fn(async () => null),
    getTimezone: vi.fn(async () => 'UTC'),
    subjectBelongsToProperty: vi.fn<GoalProgramSubjectReader['subjectBelongsToProperty']>(
      async () => true,
    ),
  }
  const service = createGoalProgramService({
    repository,
    policy,
    subjects,
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })
  return {
    service,
    policy,
    repository,
    metrics,
    subjects,
    /** The Program the service created last, as stored. */
    getCreated: async (): Promise<GoalProgramBundle | null> =>
      programId ? real.get(ORGANIZATION_ID, PROPERTY_ID, programId) : null,
    setNow: (next: Date) => {
      now = next
    },
  }
}

type GoalMetricReading = Awaited<ReturnType<GoalMetricReadPort['queryGoalMetric']>>

/** A reading of the rating-count measure; unavailable unless the patch says more. */
export const readiness = (patch: Partial<GoalMetricReading> = {}): GoalMetricReading => ({
  definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
  metricKey: 'portal.rating_count',
  state: 'unavailable',
  exactValue: null,
  sampleCount: 0,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: null,
  ...patch,
})

/** An eligible reading of `count`, complete through `sourceCompleteThrough`. */
export const eligibleCount = (
  count: number,
  sourceCompleteThrough: Date,
  patch: Partial<GoalMetricReading> = {},
): GoalMetricReading =>
  readiness({
    state: 'eligible',
    exactValue: count,
    sampleCount: count,
    sourceCompleteThrough,
    ...patch,
  })

/** The reference a result is reconciled by. */
export const resultReference = (result: { id: string }) => ({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  resultId: result.id,
})

type GoalService = ReturnType<typeof createGoalProgramHarness>['service']

/** A goal of 25 ratings for portal-1, unless the patch says otherwise. */
export const ratingsGoal = (
  service: GoalService,
  patch: Partial<Parameters<GoalService['create']>[0]> = {},
  creator: GoalActor = actor,
) =>
  service.create(
    {
      propertyId: PROPERTY_ID,
      name: 'Monthly ratings',
      metric: 'portal_rating_count',
      targetValue: 25,
      subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      ...patch,
    },
    creator,
  )
