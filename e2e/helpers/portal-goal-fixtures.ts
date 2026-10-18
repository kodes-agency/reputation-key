// Fixtures for the Monthly portal goal journeys (`monthly-portal-goal.spec.ts`,
// PLAN §3.7). Kept apart from `fixtures.ts`, which is already long.
//
// Each journey seeds its own Property (prefix `e2e-pg-`, with the run id and
// the retry in the slug) with the three Portals of the screens' example, live
// through the real Portal commands. A journey that needs history moves each
// Portal's go-live and code back and adds its readings (`seedPortalHistory`),
// and gets back the pure rule's input for the same facts, so its expected
// numbers come from `recommendPortalGoal`, never written down. Properties and
// Portals are never deleted:
// the goal tables hold RESTRICT foreign keys onto the Property, so
// `cleanupE2eData({ prefix })` would throw, and the stack is disposable. The
// teardown ends what a journey left open and takes manager-one's grants back.
import type { Page } from '@playwright/test'
import type {
  PortalGoalMeasure,
  RecommendationDayCount,
  RecommendationPortal,
  RecommendPortalGoalInput,
} from '../../src/contexts/reporting/domain/goal-recommendation-types'
import { addLocalDays, localDateOf } from '../../src/contexts/reporting/domain/local-days'
import {
  findMetricVersionById,
  METRIC_VERSION_IDS,
} from '../../src/contexts/reporting/domain/metric-registry'
import { propertyWallClockToInstant } from '../../src/shared/domain/property-calendar'
import { calendarPeriodRange } from '../../src/shared/domain/period-range'
import {
  callServerFn,
  callServerFnGet,
  dbQuery,
  e2eRunId,
  enqueueGoalProgramMaintenance,
  getUserByEmail,
  seedProperty,
  waitFor,
} from './fixtures'
import { requireE2eSeedState } from './seed-state'

export const PORTAL_GOAL_PREFIX = 'e2e-pg-'
export const MONTHLY_PORTAL_GOALS =
  'src/contexts/reporting/server/monthly-portal-goals.ts'
const PORTALS = 'src/contexts/portal/server/portals.ts'
const GOAL_PROGRAMS = 'src/contexts/reporting/server/goal-programs.ts'

/** The screens' example Property: three Portals, in name order. */
export const PORTAL_NAMES = ['Reception', 'Restaurant', 'Spa'] as const

export type SeededPortalGoalProperty = Readonly<{
  propertyId: string
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

/**
 * A Property granted to manager-one, with Reception, Restaurant and Spa each
 * created, given a code and published by the owner `page` is signed in as.
 */
export async function seedPortalGoalProperty(
  page: Page,
  suffix: string,
  retry: number,
): Promise<SeededPortalGoalProperty> {
  const seed = requireE2eSeedState()
  const managerOne = await getUserByEmail(seed.onePropertyManagerEmail)
  if (!managerOne) throw new Error('E2E manager-one is not seeded')
  const slug = `${PORTAL_GOAL_PREFIX}${e2eRunId}-${retry}-${suffix}`
  const { propertyId } = await seedProperty({
    organizationId: seed.organizationId,
    name: `E2E Portal Goal ${e2eRunId} ${retry} ${suffix}`,
    slug,
    grantAccessToUserId: managerOne.id,
  })
  // Publishing also needs a verified Google review destination on the
  // Property (portal-publication-readiness.ts), as the seed's Properties have
  // (scripts/seed-e2e-user.ts); a seeded Property starts with none.
  await dbQuery(
    `UPDATE properties
        SET google_review_destination_state = 'verified',
            google_review_uri = $2,
            google_review_destination_retrieved_at = now(),
            google_review_destination_source_epoch = 0,
            google_review_destination_profile_version = profile_version
      WHERE id = $1::uuid`,
    [propertyId, `https://search.google.com/local/writereview?placeid=${slug}`],
  )
  // A Portal is published from a snapshot of its Property's brand, in every
  // enabled language, so both exist first.
  await callServerFn(page, {
    file: PORTALS,
    exportName: 'savePropertyPortalBrandProfile',
    data: {
      propertyId,
      displayName: 'E2E Seaview Hotel',
      primaryColor: '#6366f1',
      backgroundColor: '#ffffff',
      textColor: '#111827',
    },
  })
  await callServerFn(page, {
    file: PORTALS,
    exportName: 'savePropertyPortalBrandContent',
    data: {
      propertyId,
      locale: 'en',
      title: 'How was your stay?',
      shortDescription: 'Tell the team how it went — it takes a moment.',
    },
  })
  const portals: { id: string; name: string }[] = []
  for (const name of PORTAL_NAMES) {
    const { portal } = await callServerFn<{ portal: { id: string } }>(page, {
      file: PORTALS,
      exportName: 'createPortal',
      data: {
        propertyId,
        name,
        slug: `${slug}-${name.toLowerCase()}`,
        description: 'A Portal of the monthly portal goal journeys.',
      },
    })
    // Its public address, which publishing needs, then live.
    await callServerFn(page, {
      file: PORTALS,
      exportName: 'issuePortalToken',
      data: { portalId: portal.id },
    })
    await callServerFn(page, {
      file: PORTALS,
      exportName: 'updatePortal',
      data: { portalId: portal.id, publicationState: 'published' },
    })
    portals.push({ id: portal.id, name })
  }
  return { propertyId, portals }
}

/** The Property's local day today, on the database clock: `YYYY-MM-DD`. */
export async function localToday(propertyId: string): Promise<string> {
  const [row] = await dbQuery<{ today: string }>(
    `SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today
       FROM properties WHERE id = $1::uuid`,
    [propertyId],
  )
  if (!row) throw new Error(`E2E Property ${propertyId} is not seeded`)
  return row.today
}

/**
 * Ends every goal still open on the journeys' Properties, as an operator would,
 * and takes back the grants they were given. `page` is signed in as the owner.
 */
export async function tearDownPortalGoalProperties(
  page: Page,
  propertyIds: readonly string[],
): Promise<void> {
  for (const propertyId of propertyIds) {
    const listed = await callServerFnGet<{
      programs: ReadonlyArray<{ program: { id: string; status: string } }>
    }>(page, {
      file: GOAL_PROGRAMS,
      exportName: 'listGoalPrograms',
      data: { propertyId },
    })
    for (const { program } of listed.programs) {
      if (program.status === 'ended') continue
      await callServerFn(page, {
        file: GOAL_PROGRAMS,
        exportName: 'changeGoalProgramStatus',
        data: {
          propertyId,
          programId: program.id,
          status: 'ended',
          reason: 'E2E end of a monthly portal goal journey.',
        },
      })
    }
  }
  if (propertyIds.length === 0) return
  await dbQuery('DELETE FROM property_access_grant WHERE property_id = ANY($1::uuid[])', [
    propertyIds,
  ])
}

/** Each count measure's governed version, as the guest gateway records a reading of it. */
const GOAL_COUNT_VERSIONS: Readonly<Record<PortalGoalMeasure, string>> = {
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
}
const MEASURES = ['portal_rating_count', 'qualified_scans'] as const

function governedCount(measure: PortalGoalMeasure) {
  const governed = findMetricVersionById(GOAL_COUNT_VERSIONS[measure])
  const sourcePolicy = governed?.version.sourcePolicyAllowlist[0]
  if (!governed || !sourcePolicy) throw new Error(`No governed version for ${measure}`)
  return { governed, sourcePolicy }
}

/** One Portal's past: when it went live and its code was made, and its readings. */
export type PortalHistory = Readonly<{
  portal: Readonly<{ id: string; name: string }>
  liveDaysAgo: number
  codeDaysAgo: number
  /** One private rating at local noon per entry, each a number of days ago. */
  ratingsDaysAgo: readonly number[]
  /** One scan at local noon per entry, each a number of days ago. */
  scansDaysAgo: readonly number[]
}>

/** Local noon on the Property's day `daysAgo` before today: never near a clock change. */
function localNoon(today: string, daysAgo: number, timezone: string): Date {
  const [year = 0, month = 1, day = 1] = addLocalDays(today, -daysAgo)
    .split('-')
    .map(Number)
  return propertyWallClockToInstant(
    { year, month, day, hour: 12, minute: 0, second: 0, millisecond: 0 },
    timezone,
  )
}

/** Readings of one measure at one Portal, recorded as the guest gateway records them. */
async function insertReadings(
  property: Readonly<{ propertyId: string; organizationId: string }>,
  portalId: string,
  measure: PortalGoalMeasure,
  at: readonly Date[],
): Promise<void> {
  if (at.length === 0) return
  const { governed, sourcePolicy } = governedCount(measure)
  await dbQuery(
    `INSERT INTO metric_readings (
       organization_id, property_id, portal_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     )
     SELECT $1, $2::uuid, $3::uuid, $4, 1, $5::uuid,
       $8 || gen_random_uuid()::text, $6, 1, 1, 'exact',
       reading.at, reading.at,
       to_char(reading.at AT TIME ZONE properties.timezone, 'YYYY-MM-DD'),
       'exact', 'standard'
     FROM unnest($7::timestamptz[]) AS reading(at)
     JOIN properties ON properties.id = $2::uuid`,
    [
      property.organizationId,
      property.propertyId,
      portalId,
      governed.definition.key,
      governed.version.id,
      sourcePolicy,
      at.map((instant) => instant.toISOString()),
      PORTAL_GOAL_PREFIX,
    ],
  )
}

/** Readings per Portal, measure and local day, as the recommendation reads them. */
function dayCounts(
  portalId: string,
  measure: PortalGoalMeasure,
  at: readonly Date[],
  timezone: string,
): RecommendationDayCount[] {
  const byDay = new Map<string, number>()
  for (const instant of at) {
    const day = localDateOf(instant, timezone)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  return [...byDay].map(([localDay, count]) => ({ portalId, measure, localDay, count }))
}

/**
 * Moves each Portal's go-live (its open activation) and code back to local noon
 * that many days ago, adds its readings, and returns the pure rule's input for
 * the same facts as of the database's clock, so a journey works its expected
 * numbers out with `recommendPortalGoal`.
 */
export async function seedPortalHistory(
  propertyId: string,
  histories: readonly PortalHistory[],
): Promise<RecommendPortalGoalInput> {
  const [property] = await dbQuery<{
    organizationId: string
    timezone: string
    now: Date
    today: string
  }>(
    `SELECT organization_id AS "organizationId", timezone, now() AS now,
            to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today
       FROM properties WHERE id = $1::uuid`,
    [propertyId],
  )
  if (!property) throw new Error(`E2E Property ${propertyId} is not seeded`)
  const { timezone, today } = property
  const noon = (daysAgo: number) => localNoon(today, daysAgo, timezone)
  const portals: RecommendationPortal[] = []
  const days: RecommendationDayCount[] = []
  const lastScanAt = new Map<string, Date>()
  for (const history of histories) {
    const { portal } = history
    const liveSince = noon(history.liveDaysAgo)
    const codeIssuedAt = noon(history.codeDaysAgo)
    await dbQuery(
      `UPDATE portal_publication_activations SET activated_at = $2
        WHERE portal_id = $1::uuid AND deactivated_at IS NULL`,
      [portal.id, liveSince.toISOString()],
    )
    await dbQuery(`UPDATE portal_tokens SET issued_at = $2 WHERE portal_id = $1::uuid`, [
      portal.id,
      codeIssuedAt.toISOString(),
    ])
    const ratings = history.ratingsDaysAgo.map(noon)
    const scans = history.scansDaysAgo.map(noon)
    const owner = { propertyId, organizationId: property.organizationId }
    await insertReadings(owner, portal.id, 'portal_rating_count', ratings)
    await insertReadings(owner, portal.id, 'qualified_scans', scans)
    portals.push({
      portalId: portal.id,
      name: portal.name,
      publicationState: 'published',
      liveSince,
      liveIntervals: [{ from: liveSince, to: null }],
      codeIssuedAt,
      codeReady: true,
      portalGroupId: null,
    })
    days.push(
      ...dayCounts(portal.id, 'portal_rating_count', ratings, timezone),
      ...dayCounts(portal.id, 'qualified_scans', scans, timezone),
    )
    const lastScan = scans.reduce<Date | null>(
      (last, at) => (last === null || at > last ? at : last),
      null,
    )
    if (lastScan) lastScanAt.set(portal.id, lastScan)
  }
  return {
    now: new Date(property.now),
    timezone,
    versionFrom: new Date(
      Math.max(
        ...MEASURES.map((measure) =>
          governedCount(measure).governed.version.effectiveFrom.getTime(),
        ),
      ),
    ),
    portals,
    truncated: false,
    days,
    unreadable: [],
    lastScanAt,
  }
}

/** Next month on the Property's own calendar, as the `YYYY-MM` key a goal starts on. */
export async function nextMonthKey(propertyId: string): Promise<string> {
  const [row] = await dbQuery<{ month: string }>(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE timezone) + interval '1 month',
                    'YYYY-MM') AS month
       FROM properties WHERE id = $1::uuid`,
    [propertyId],
  )
  if (!row) throw new Error(`E2E Property ${propertyId} is not seeded`)
  return row.month
}

/**
 * Gives a goal set for next month a month that has closed (J11), as the
 * month-end close would leave it: its first version and subject end where they
 * began, a second version and subject count from that month, and the month's
 * result is written closed with `value` against the goal's number (the shape
 * `beta-product-journeys.spec.ts` gives a completed month). A month closes a
 * day after it ends, so in a month's first 25 hours the month before last is
 * used. Returns that month's first instant and the Property's time zone.
 */
export async function closePortalGoalMonth(
  input: Readonly<{ propertyId: string; programId: string; value: number }>,
): Promise<Readonly<{ periodStart: Date; timezone: string }>> {
  const [period] = await dbQuery<{
    organizationId: string
    timezone: string
    periodStart: Date
    periodEnd: Date
  }>(
    `SELECT organization_id AS "organizationId", timezone,
            ((date_trunc('month', now() AT TIME ZONE timezone) - shift.months_back)
              AT TIME ZONE timezone) AS "periodStart",
            ((date_trunc('month', now() AT TIME ZONE timezone) - shift.months_back
              + interval '1 month') AT TIME ZONE timezone) AS "periodEnd"
       FROM properties
       CROSS JOIN LATERAL (
         SELECT CASE
           WHEN now() < (date_trunc('month', now() AT TIME ZONE timezone)
             AT TIME ZONE timezone) + interval '25 hours'
           THEN interval '2 months'
           ELSE interval '1 month'
         END AS months_back
       ) AS shift
      WHERE id = $1::uuid`,
    [input.propertyId],
  )
  if (!period) throw new Error(`E2E Property ${input.propertyId} is not seeded`)
  const closed = await dbQuery<{ id: string }>(
    `WITH original_version AS MATERIALIZED (
       SELECT * FROM goal_program_versions
        WHERE organization_id = $1 AND property_id = $2::uuid
          AND program_id = $3::uuid AND version = 1
     ),
     closed_assignments AS (
       UPDATE goal_subject_assignments AS assignment
          SET effective_to = assignment.effective_from
         FROM original_version
        WHERE assignment.organization_id = $1
          AND assignment.property_id = $2::uuid
          AND assignment.program_id = $3::uuid
          AND assignment.program_version_id = original_version.id
       RETURNING assignment.*
     ),
     closed_version AS (
       UPDATE goal_program_versions AS version
          SET effective_to = version.effective_from
         FROM original_version
        WHERE version.id = original_version.id
       RETURNING version.*
     ),
     inserted_version AS (
       INSERT INTO goal_program_versions (
         id, program_id, organization_id, property_id, version,
         metric_definition_id, metric_definition_version_id, metric_key,
         metric_minimum_sample, target_value, property_timezone,
         effective_from, effective_to, change_reason, created_by, created_at
       )
       SELECT
         gen_random_uuid(), program_id, organization_id, property_id, 2,
         metric_definition_id, metric_definition_version_id, metric_key,
         metric_minimum_sample, target_value, property_timezone,
         $4::timestamptz, NULL, 'E2E closed month', created_by, now()
       FROM closed_version
       RETURNING *
     ),
     inserted_assignment AS (
       INSERT INTO goal_subject_assignments (
         id, program_id, program_version_id, organization_id, property_id,
         metric_key, subject_kind, property_subject_id, portal_group_id,
         portal_id, effective_from, effective_to, created_by, created_at
       )
       SELECT
         gen_random_uuid(), prior.program_id, version.id, prior.organization_id,
         prior.property_id, prior.metric_key, prior.subject_kind,
         prior.property_subject_id, prior.portal_group_id, prior.portal_id,
         $4::timestamptz, NULL, prior.created_by, now()
       FROM closed_assignments AS prior
       CROSS JOIN inserted_version AS version
       RETURNING *
     ),
     inserted_result AS (
       INSERT INTO goal_monthly_results (
         id, assignment_id, program_id, program_version_id, organization_id,
         property_id, period_start, period_end, property_timezone,
         status, evaluation_state, value, sample_count, achieved, reason,
         source_complete_through, evaluation_watermark, closed_at
       )
       SELECT
         gen_random_uuid(), assignment.id, assignment.program_id, version.id,
         assignment.organization_id, assignment.property_id,
         $4::timestamptz, $5::timestamptz, version.property_timezone,
         'closed', 'eligible', $6::integer, $6::integer,
         $6::integer >= version.target_value, NULL,
         $5::timestamptz, $5::timestamptz, now()
       FROM inserted_assignment AS assignment
       CROSS JOIN inserted_version AS version
       RETURNING id
     )
     UPDATE goal_programs AS program
        SET status = 'active', status_reason = NULL, current_version = 2,
            updated_at = now()
      WHERE program.organization_id = $1
        AND program.property_id = $2::uuid
        AND program.id = $3::uuid
        AND program.status = 'scheduled'
        AND EXISTS (SELECT 1 FROM inserted_result)
     RETURNING program.id`,
    [
      period.organizationId,
      input.propertyId,
      input.programId,
      period.periodStart,
      period.periodEnd,
      input.value,
    ],
  )
  if (closed.length !== 1)
    throw new Error(`E2E goal ${input.programId} was not moved back`)
  return { periodStart: new Date(period.periodStart), timezone: period.timezone }
}

/**
 * Moves a Monthly portal goal set from next month (so still scheduled, with no
 * month) back to last month, as the beta journeys' goal does
 * (`beta-product-journeys.spec.ts`): its first version keeps an empty window,
 * a second one starts on last month's first day with that month open, and the
 * goal is active. The maintenance job then reads last month again and opens
 * this one, which this waits for: the goal has run since last month, so this
 * month is not its first.
 */
export async function runMonthlyGoalSinceLastMonth(
  input: Readonly<{ propertyId: string; programId: string; timezone: string; now: Date }>,
): Promise<void> {
  const seed = requireE2eSeedState()
  const thisMonth = calendarPeriodRange(input.now, input.timezone, 'monthly')
  const lastMonth = calendarPeriodRange(
    new Date(thisMonth.start.getTime() - 1),
    input.timezone,
    'monthly',
  )
  const moved = await dbQuery<{ id: string }>(
    `WITH original_version AS MATERIALIZED (
       SELECT * FROM goal_program_versions
        WHERE organization_id = $1 AND property_id = $2::uuid
          AND program_id = $3::uuid AND version = 1
     ),
     closed_assignments AS (
       UPDATE goal_subject_assignments AS assignment
          SET effective_to = assignment.effective_from
         FROM original_version
        WHERE assignment.organization_id = $1
          AND assignment.property_id = $2::uuid
          AND assignment.program_id = $3::uuid
          AND assignment.program_version_id = original_version.id
       RETURNING assignment.*
     ),
     closed_version AS (
       UPDATE goal_program_versions AS version
          SET effective_to = version.effective_from
         FROM original_version
        WHERE version.id = original_version.id
       RETURNING version.*
     ),
     inserted_version AS (
       INSERT INTO goal_program_versions (
         id, program_id, organization_id, property_id, version,
         metric_definition_id, metric_definition_version_id, metric_key,
         metric_minimum_sample, target_value, property_timezone,
         effective_from, effective_to, change_reason, created_by, created_at
       )
       SELECT gen_random_uuid(), program_id, organization_id, property_id, 2,
         metric_definition_id, metric_definition_version_id, metric_key,
         metric_minimum_sample, target_value, property_timezone,
         $4::timestamptz, NULL, 'E2E running since last month', created_by, now()
       FROM closed_version
       RETURNING *
     ),
     inserted_assignment AS (
       INSERT INTO goal_subject_assignments (
         id, program_id, program_version_id, organization_id, property_id,
         metric_key, subject_kind, property_subject_id, portal_group_id,
         portal_id, effective_from, effective_to, created_by, created_at
       )
       SELECT gen_random_uuid(), prior.program_id, version.id, prior.organization_id,
         prior.property_id, prior.metric_key, prior.subject_kind,
         prior.property_subject_id, prior.portal_group_id, prior.portal_id,
         $4::timestamptz, NULL, prior.created_by, now()
       FROM closed_assignments AS prior
       CROSS JOIN inserted_version AS version
       RETURNING *
     ),
     inserted_result AS (
       INSERT INTO goal_monthly_results (
         id, assignment_id, program_id, program_version_id, organization_id,
         property_id, period_start, period_end, property_timezone,
         status, evaluation_state, sample_count, reason
       )
       SELECT gen_random_uuid(), assignment.id, assignment.program_id, version.id,
         assignment.organization_id, assignment.property_id,
         $4::timestamptz, $5::timestamptz, version.property_timezone,
         'open', 'updating', 0, 'period_open'
       FROM inserted_assignment AS assignment
       CROSS JOIN inserted_version AS version
       RETURNING id
     )
     UPDATE goal_programs AS program
        SET status = 'active', status_reason = NULL, current_version = 2,
            updated_at = now()
      WHERE program.organization_id = $1
        AND program.property_id = $2::uuid
        AND program.id = $3::uuid
        AND program.status = 'scheduled'
        AND EXISTS (SELECT 1 FROM inserted_result)
     RETURNING program.id`,
    [
      seed.organizationId,
      input.propertyId,
      input.programId,
      lastMonth.start.toISOString(),
      lastMonth.end.toISOString(),
    ],
  )
  if (moved.length !== 1) throw new Error('E2E goal was not moved to last month')
  await enqueueGoalProgramMaintenance({
    organizationId: seed.organizationId,
    propertyId: input.propertyId,
  })
  await waitFor(
    async () => {
      const [opened] = await dbQuery<{ id: string }>(
        `SELECT id FROM goal_monthly_results
          WHERE organization_id = $1 AND property_id = $2::uuid
            AND program_id = $3::uuid AND period_start = $4::timestamptz
            AND status = 'open'`,
        [
          seed.organizationId,
          input.propertyId,
          input.programId,
          thisMonth.start.toISOString(),
        ],
      )
      return opened ?? null
    },
    {
      description:
        'goal maintenance opens this month for a goal running since last month',
      diagnose: async () =>
        dbQuery(
          `SELECT period_start, status, evaluation_state FROM goal_monthly_results
            WHERE program_id = $1::uuid ORDER BY period_start`,
          [input.programId],
        ),
    },
  )
}
