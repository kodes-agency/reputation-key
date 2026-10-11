// Fixtures for the table that sets several goals: its stories and its unit
// tests. The `.stories.` segment keeps this module out of production-shaped
// source inventories and bundles.
//
// A Property in Sofia with two Portals, an archived one and a Portal Group, and
// the goals other people have already set there.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { subjectHolds } from '#/contexts/reporting/application/goal-subject-holds'
import type { GoalBulkSubject } from './goal-bulk-view'

type GoalBundle = Parameters<typeof subjectHolds>[0][number]

export const BULK_PROPERTY = {
  id: '10000000-0000-4000-8000-000000000001',
  timezone: 'Europe/Sofia',
} as const

export const LOBBY_ID = '30000000-0000-4000-8000-000000000001'
export const BAR_ID = '30000000-0000-4000-8000-000000000002'
const SPA_ID = '30000000-0000-4000-8000-000000000003'
export const FLOOR_ID = '60000000-0000-4000-8000-000000000001'

export const BULK_PORTALS = [
  { id: LOBBY_ID, name: 'Lobby QR', publicationState: 'published' },
  { id: BAR_ID, name: 'Bar QR', publicationState: 'draft' },
  { id: SPA_ID, name: 'Old spa desk', publicationState: 'archived' },
] as const

export const BULK_GROUPS = [{ id: FLOOR_ID, name: 'First floor' }] as const

// The Property's calendar: October starts at 21:00 UTC on 30 September.
const OCTOBER = new Date('2026-09-30T21:00:00.000Z')
const NOVEMBER = new Date('2026-10-31T22:00:00.000Z')
/** The 11th: a goal starts this month unless its creator picks the next. */
export const EARLY_IN_OCTOBER = new Date('2026-10-11T09:00:00.000Z')
/** The 21st: a goal starts next month unless its creator picks this one. */
export const LATE_IN_OCTOBER = new Date('2026-10-21T09:00:00.000Z')

/**
 * A goal with one subject, as the goal list returns it. `to` closes the
 * subject's window: a goal ended in October holds its subject until November.
 */
function bulkGoal(
  input: Readonly<{
    id: string
    name: string
    subject: GoalBulkSubject
    targetValue: number
    metric?: GoalMetric
    to?: Date
  }>,
): GoalBundle {
  const metric = input.metric ?? 'portal_rating_count'
  const ended = input.to !== undefined
  const version = {
    id: `${input.id}-v1`,
    programId: input.id,
    organizationId: 'org-1',
    propertyId: BULK_PROPERTY.id,
    version: 1,
    metricDefinitionId: 'metric-definition-1',
    metricDefinitionVersionId: 'metric-version-1',
    metric,
    metricMinimumSample: 0,
    targetValue: input.targetValue,
    propertyTimezone: BULK_PROPERTY.timezone,
    effectiveFrom: OCTOBER,
    effectiveTo: input.to ?? null,
    changeReason: 'created',
    createdBy: 'manager-1',
    createdAt: OCTOBER,
  }
  return {
    program: {
      id: input.id,
      organizationId: 'org-1',
      propertyId: BULK_PROPERTY.id,
      name: input.name,
      description: null,
      status: ended ? 'ended' : 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'manager-1',
      createdAt: OCTOBER,
      updatedAt: OCTOBER,
    },
    version,
    versions: [version],
    assignments: [
      {
        id: `${input.id}-a1`,
        programId: input.id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: BULK_PROPERTY.id,
        metric,
        subject: input.subject,
        effectiveFrom: OCTOBER,
        effectiveTo: input.to ?? null,
        createdBy: 'manager-1',
        createdAt: OCTOBER,
      },
    ],
    results: [],
  }
}

/** The Lobby's goal for private ratings, live: target 400. */
export const LOBBY_RATINGS = bulkGoal({
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Lobby ratings',
  subject: { kind: 'portal', portalId: LOBBY_ID },
  targetValue: 400,
})

/** The same goal ended in October: it holds the Lobby until the month is over. */
export const LOBBY_RATINGS_ENDED = bulkGoal({
  id: '20000000-0000-4000-8000-000000000002',
  name: 'Lobby ratings',
  subject: { kind: 'portal', portalId: LOBBY_ID },
  targetValue: 400,
  to: NOVEMBER,
})

/** A goal each for the Bar and the first floor: with the Lobby's, no row is left open. */
export const BAR_RATINGS = bulkGoal({
  id: '20000000-0000-4000-8000-000000000003',
  name: 'Bar ratings',
  subject: { kind: 'portal', portalId: BAR_ID },
  targetValue: 120,
})
export const FLOOR_RATINGS = bulkGoal({
  id: '20000000-0000-4000-8000-000000000004',
  name: 'First floor ratings',
  subject: { kind: 'portal_group', portalGroupId: FLOOR_ID },
  targetValue: 900,
})
