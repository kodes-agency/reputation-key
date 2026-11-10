// PostgreSQL scenarios for the Property Google rating goal use cases: one held
// transaction, a savepoint per test that is rolled back, the real repository.
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  propertyRatingGoalChanges,
  propertyRatingGoalDeferrals,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { PropertyRatingGoal, RatingGoalChange } from '../../domain/rating-goal'
import { legacyPacePerWeek } from '../../domain/rating-goal-pace'
import type { RatingGoalNotice } from '../../domain/rating-goal-notices'
import type { PropertyRatingGoalRepository } from '../../application/ports/property-rating-goal.repository'
import { createPropertyRatingGoalRepository } from '../repositories/property-rating-goal.repository'

export const RATING_GOAL_ORGANIZATION = 'org-rating-goal'
export const RATING_GOAL_PROPERTY = '30000000-0000-4000-8000-000000000001'

/** The part of a scenario's world that lives in PostgreSQL. */
export type MirroredWorld = {
  goals: PropertyRatingGoal[]
  changes: RatingGoalChange[]
  notices: Array<RatingGoalNotice & Readonly<{ goalId: string }>>
  notNow: Array<
    Readonly<{
      organizationId: string
      propertyId: string
      chosenBy: string
      chosenAt: Date
    }>
  >
}

export const nextScenarioId = (): string =>
  `40000000-0000-4000-8000-${String(++issuedIds).padStart(12, '0')}`

let held: HeldTransaction | undefined
/** Ids stay unique across the commands of one scenario: they are primary keys now. */
let issuedIds = 0

/**
 * Opens the database the rating goal scenarios run on: one held transaction,
 * with a savepoint per test that is rolled back, so no scenario sees another's
 * rows and nothing is committed.
 */
export function useRatingGoalDatabase(): void {
  beforeAll(async () => {
    registerAllEventSchemas()
    held = await holdTransaction()
  })
  afterAll(async () => {
    await held?.rollBack()
    held = undefined
  })
  beforeEach(async () => {
    issuedIds = 0
    await held!.client.query('SAVEPOINT rating_goal_scenario')
    await ensureProperty(RATING_GOAL_PROPERTY)
  })
  afterEach(async () => {
    await held!.client.query('ROLLBACK TO SAVEPOINT rating_goal_scenario')
  })
}

async function ensureProperty(propertyId: string): Promise<void> {
  await held!.client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Rating goal Property', $3, 'Europe/Sofia')
     ON CONFLICT DO NOTHING`,
    [propertyId, RATING_GOAL_ORGANIZATION, `rating-goal-${propertyId}`],
  )
}

const goalValues = (goal: PropertyRatingGoal) => ({
  id: goal.id,
  organizationId: goal.organizationId,
  propertyId: goal.propertyId,
  sourceEpoch: goal.sourceEpoch,
  mode: goal.mode,
  targetTenths: goal.targetTenths,
  qualityTenths: goal.qualityTenths,
  paceTenthsPerWeek: goal.paceTenthsPerWeek,
  pacePerWeek:
    goal.paceTenthsPerWeek === null ? null : legacyPacePerWeek(goal.paceTenthsPerWeek),
  status: goal.state,
  endedReason: goal.endedReason,
  baselineReviewCount: goal.baseline.reviewCount,
  baselineGoogleAverage: goal.baseline.googleAverage,
  baselineExactAverage: goal.baseline.exactAverage,
  lastDisplayedTenths: goal.lastEvaluation.displayedTenths,
  lastEvaluatedStatus: goal.lastEvaluation.status,
  lastEvaluatedAt: goal.lastEvaluation.evaluatedAt,
  lastKnownStatus: goal.lastEvaluation.knownStatus,
  belowPaceNoticedAt: goal.lastEvaluation.belowPaceNoticedAt,
  tooLowNoticedAt: goal.lastEvaluation.tooLowNoticedAt,
  paceSince: goal.paceSince,
  recapAnsweredWeek: goal.recapAnsweredWeek,
  reachedAt: goal.reachedAt,
  endedAt: goal.endedAt,
  createdBy: goal.createdBy,
  createdAt: goal.createdAt,
  updatedAt: goal.updatedAt,
  version: goal.version,
})

/** What the world last agreed with the database on, by array identity. */
const synced = new WeakMap<
  MirroredWorld,
  { goals: MirroredWorld['goals']; changes: MirroredWorld['changes'] }
>()

/** The stored row each goal was last read from, so unchanged goals are not read again. */
const goalSnapshots = new WeakMap<MirroredWorld, Map<string, string>>()

const organizationsOf = (world: MirroredWorld): readonly string[] => [
  ...new Set([
    RATING_GOAL_ORGANIZATION,
    ...world.goals.map((goal) => goal.organizationId),
  ]),
]

/**
 * Writes what a test put in `world.goals` and `world.changes` into PostgreSQL,
 * when it replaced them since the last call. Goals and changes the test no
 * longer lists are deleted.
 */
async function writeSeeds(world: MirroredWorld): Promise<void> {
  const db = held!.db
  const known = synced.get(world)
  if (known?.goals !== world.goals) {
    const organizations = organizationsOf(world)
    const keptGoals = world.goals.map((goal) => goal.id)
    await db
      .delete(propertyRatingGoalChanges)
      .where(
        and(
          inArray(propertyRatingGoalChanges.organizationId, [...organizations]),
          keptGoals.length
            ? notInArray(propertyRatingGoalChanges.goalId, keptGoals)
            : undefined,
        ),
      )
    await db
      .delete(propertyRatingGoals)
      .where(
        and(
          inArray(propertyRatingGoals.organizationId, [...organizations]),
          keptGoals.length ? notInArray(propertyRatingGoals.id, keptGoals) : undefined,
        ),
      )
    for (const goal of world.goals) {
      await ensureProperty(goal.propertyId)
      const values = goalValues(goal)
      await db
        .insert(propertyRatingGoals)
        .values(values)
        .onConflictDoUpdate({ target: propertyRatingGoals.id, set: values })
    }
  }
  if (known?.changes !== world.changes) {
    const kept = world.changes.map((change) => change.id)
    await db
      .delete(propertyRatingGoalChanges)
      .where(
        and(
          inArray(propertyRatingGoalChanges.organizationId, [...organizationsOf(world)]),
          kept.length ? notInArray(propertyRatingGoalChanges.id, kept) : undefined,
        ),
      )
    for (const change of world.changes) {
      await db
        .insert(propertyRatingGoalChanges)
        .values(change)
        .onConflictDoUpdate({ target: propertyRatingGoalChanges.id, set: change })
    }
  }
}

const NOTICE_FIELDS = [
  'targetTenths',
  'shownTenths',
  'previousTenths',
  'pacePerWeek',
  'paceTenthsPerWeek',
  'recentPaceTenths',
  'paceWindow',
] as const

/**
 * Reads the database back into `world`: the goals and their changes, the
 * notices each evaluation wrote as facts, and the "not now" choices.
 */
async function readBack(world: MirroredWorld): Promise<void> {
  const db = held!.db
  const organizations = [...organizationsOf(world)]
  const order = new Map(world.goals.map((goal, index) => [goal.id, index]))
  const seedOrder = (id: string) => order.get(id) ?? order.size
  const repository = createPropertyRatingGoalRepository(db)

  const rows = await db
    .select()
    .from(propertyRatingGoals)
    .where(inArray(propertyRatingGoals.organizationId, organizations))
    .orderBy(asc(propertyRatingGoals.createdAt), asc(propertyRatingGoals.id))
  const previous = new Map(world.goals.map((goal) => [goal.id, goal]))
  const snapshots = goalSnapshots.get(world) ?? new Map<string, string>()
  const nextSnapshots = new Map<string, string>()
  const goals: PropertyRatingGoal[] = []
  for (const row of rows) {
    const snapshot = JSON.stringify(row)
    nextSnapshots.set(row.id, snapshot)
    const unchanged =
      snapshots.get(row.id) === snapshot ? previous.get(row.id) : undefined
    const goal =
      unchanged ?? (await repository.findById(row.organizationId, row.propertyId, row.id))
    if (goal) goals.push(goal)
  }
  goalSnapshots.set(world, nextSnapshots)
  goals.sort((left, right) => seedOrder(left.id) - seedOrder(right.id))

  const changeOrder = new Map(world.changes.map((change, index) => [change.id, index]))
  const changeRows = await db
    .select()
    .from(propertyRatingGoalChanges)
    .where(inArray(propertyRatingGoalChanges.organizationId, organizations))
    .orderBy(
      asc(propertyRatingGoalChanges.changedAt),
      sql`${propertyRatingGoalChanges}.ctid`,
    )
  const changes = [...changeRows].sort(
    (left, right) =>
      (changeOrder.get(left.id) ?? changeOrder.size) -
      (changeOrder.get(right.id) ?? changeOrder.size),
  ) as RatingGoalChange[]

  const events = await db
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.eventType, 'goal.rating_goal.transitioned'),
        inArray(outboxEvents.organizationId, organizations),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt), sql`${outboxEvents}.ctid`)
  const notices = events.map(({ payload }) => {
    const fact = payload as Record<string, unknown>
    const notice: Record<string, unknown> = {
      goalId: fact.goalId,
      transition: fact.transition,
    }
    for (const field of NOTICE_FIELDS) {
      if (fact[field] !== null && fact[field] !== undefined) notice[field] = fact[field]
    }
    if (fact.transition === 'google_rating_changed') notice.mode = fact.mode
    return notice as MirroredWorld['notices'][number]
  })

  const deferrals = await db
    .select()
    .from(propertyRatingGoalDeferrals)
    .where(inArray(propertyRatingGoalDeferrals.organizationId, organizations))
  world.goals = goals
  world.changes = changes
  world.notices = notices
  world.notNow = deferrals.map((row) => ({
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    chosenBy: row.deferredBy,
    chosenAt: row.deferredAt,
  }))
  synced.set(world, { goals: world.goals, changes: world.changes })
}

/**
 * The real repository over PostgreSQL. Around each call the world is written
 * to the database and read back, so a test seeds `world.goals` and reads it
 * after the command, and both are the stored rows.
 */
export function databaseRepository(world: MirroredWorld): PropertyRatingGoalRepository {
  const real = createPropertyRatingGoalRepository(held!.db)
  const wrapped = Object.fromEntries(
    Object.entries(real).map(([method, call]) => [
      method,
      async (...args: unknown[]) => {
        await writeSeeds(world)
        try {
          return await (call as (...input: unknown[]) => Promise<unknown>)(...args)
        } finally {
          await readBack(world)
        }
      },
    ]),
  ) as unknown as PropertyRatingGoalRepository
  return {
    ...wrapped,
    // Goals of other scenarios may be committed to the same database.
    listActiveGoalScopes: async (after, limit) => {
      const own = new Set(organizationsOf(world))
      const collected: Awaited<ReturnType<typeof real.listActiveGoalScopes>>[number][] =
        []
      let cursor = after
      for (;;) {
        const page = await wrapped.listActiveGoalScopes(cursor, limit)
        collected.push(...page.filter((scope) => own.has(scope.organizationId)))
        const last = page.at(-1)
        if (page.length < limit || !last || collected.length >= limit) break
        cursor = { goalId: last.goalId }
      }
      return collected.slice(0, limit)
    },
  }
}
