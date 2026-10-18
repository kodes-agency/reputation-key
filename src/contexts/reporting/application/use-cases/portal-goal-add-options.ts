// Reporting — what "Add a portal goal" offers (ADR 0068, PLAN PG-20; copy deck
// M-1…M-14).
//
// A goal for one Portal, or for each, next to the Property's Monthly portal
// goal (P-5: most properties don't need one); a goal for a Portal Group; or the
// average private rating for the whole Property. One composed read, asked for
// `goal.create` before anything is read, since whoever sees the sheet is
// whoever may add the goal. It reads the clock once, then the Programs the
// actor may see and the recommendation's facts together, and the names of the
// Property's Portal Groups a few at a time.
//
// The server decides what is open (PLAN E12):
// - one Portal and each Portal need 2 or more live Portals (with one, the
//   Monthly portal goal is that Portal's goal already);
// - a group, a group with a listed Portal;
// - the average, 10 private ratings in the last 4 weeks (a month needs 10).
// Each Portal or group gets the rule's numbers on its own (`portal-goal-add-
// numbers.ts`) in the month and measure the Property's recommendation offers,
// and "Has a goal" when one already counts that measure for it from that
// month: a subject takes one goal per measure at a time. It writes nothing.
import { minimumSampleForGoalMetric } from '../../domain/goal-program'
import type { PortalFacts } from '../../domain/goal-recommendation-types'
import { goalStartOptions } from '../../domain/goal-start'
import { goalSubjectIdentity, type GoalSubject } from '../../domain/goal-subject'
import type {
  PortalGoalAddEachRow,
  PortalGoalAddHeld,
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '../dto/monthly-portal-goal-add.types'
import { subjectHolds } from '../goal-subject-holds'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import type { GoalSubjectNameReader } from './goal-bulk-create'
import { inParallel } from './goal-list-progress'
import type { GoalActor, GoalExecutionPolicy, GoalProgramService } from './goal-programs'
import {
  gatherPortalGoalFacts,
  recommendationFrom,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import {
  groupMembers,
  groupNumbers,
  livePortalsOf,
  portalGoalAddBasisOf,
  portalNumbers,
  type PortalGoalAddBasis,
} from './portal-goal-add-numbers'

export type PortalGoalAddOptionsDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** The Programs the actor may see (`withGoalProgramVisibility`). */
  reads: Pick<GoalProgramService, 'list'>
  recommendation: PortalGoalRecommendationReads
  /** The Portal Groups' names. */
  subjectNames: Pick<GoalSubjectNameReader, 'getSubjectName'>
  now: () => Date
}>

/** One Portal and each Portal are offered from this many live Portals. */
const MIN_LIVE_PORTALS = 2
/** Group names asked of Portal at once. */
const NAME_CONCURRENCY = 3

type Holds = (subject: GoalSubject) => PortalGoalAddHeld | null

/** Who already holds a subject for the measure from the month offered, by subject. */
function holdsOf(
  programs: readonly GoalProgramBundle[],
  metric: Parameters<typeof subjectHolds>[1],
  from: Date,
): Holds {
  const held = new Map(
    subjectHolds(programs, metric, from).map((hold) => [
      goalSubjectIdentity(hold.subject),
      { programId: hold.programId, name: hold.programName },
    ]),
  )
  return (subject) => held.get(goalSubjectIdentity(subject)) ?? null
}

function portalOffer(
  basis: PortalGoalAddBasis,
  portal: PortalFacts,
  holds: Holds,
): PortalGoalAddOffer {
  const subject = { kind: 'portal', portalId: portal.portalId } as const
  return {
    subject,
    name: portal.name,
    ...portalNumbers(basis, portal),
    readyOn: portal.joinsOn,
    heldBy: holds(subject),
  }
}

function eachRow(offer: PortalGoalAddOffer): PortalGoalAddEachRow {
  const number = offer.choices?.aBitMore ?? null
  return { offer, ticked: number !== null && offer.heldBy === null, number }
}

/** The Property's groups with a listed Portal, in Portal's order of their first one. */
const groupIdsOf = (basis: PortalGoalAddBasis): readonly string[] => [
  ...new Set(
    basis.facts.listed.portals.flatMap(({ portalGroupId }) =>
      portalGroupId === null ? [] : [portalGroupId],
    ),
  ),
]

function groupOffer(
  basis: PortalGoalAddBasis,
  group: Readonly<{ id: string; name: string }>,
  holds: Holds,
): PortalGoalAddOffer {
  const subject = { kind: 'portal_group', portalGroupId: group.id } as const
  const members = groupMembers(basis, group.id)
  const joins = members.flatMap(({ joinsOn }) => (joinsOn === null ? [] : [joinsOn]))
  return {
    subject,
    name: group.name,
    ...groupNumbers(basis, group.id),
    // Live, with none of its Portals in the number yet: the day the first joins.
    readyOn: members.some(({ inBasis }) => inBasis)
      ? null
      : ([...joins].sort()[0] ?? null),
    heldBy: holds(subject),
  }
}

/** Each group by name, in name order; a group whose name cannot be read is left out. */
async function namedGroups(
  deps: Pick<PortalGoalAddOptionsDeps, 'subjectNames'>,
  ids: readonly string[],
  scope: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<readonly Readonly<{ id: string; name: string }>[]> {
  const named = await inParallel(ids, NAME_CONCURRENCY, async (id) => {
    const name = await deps.subjectNames.getSubjectName(
      scope.organizationId,
      scope.propertyId,
      { kind: 'portal_group', portalGroupId: id },
    )
    return name === null ? [] : [{ id, name }]
  })
  return named
    .flat()
    .sort(
      (a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        (a.id < b.id ? -1 : 1),
    )
}

/** What the sheet offers, from what was read. */
function portalGoalAddOptionsOf(
  basis: PortalGoalAddBasis,
  read: Readonly<{
    propertyId: string
    programs: readonly GoalProgramBundle[]
    groups: readonly Readonly<{ id: string; name: string }>[]
  }>,
): PortalGoalAddOptions {
  const { propertyId, programs, groups } = read
  const { recommendation, facts, month, measure } = basis
  const { current, next } = goalStartOptions(facts.now, facts.timezone)
  const from = (month === current.monthKey ? current : next).period.start
  const holds = holdsOf(programs, measure, from)
  const live = livePortalsOf(recommendation)
  const portals =
    live.length < MIN_LIVE_PORTALS
      ? []
      : live.map((portal) => portalOffer(basis, portal, holds))
  const ratings = recommendation.windowTotals.portal_rating_count
  return {
    month,
    current: basis.current,
    measure,
    onePortal: portals,
    eachPortal: portals.map(eachRow),
    groups: groups.map((group) => groupOffer(basis, group, holds)),
    average: {
      available: ratings >= minimumSampleForGoalMetric('portal_rating_average'),
      last4Weeks: ratings,
      heldBy: holdsOf(
        programs,
        'portal_rating_average',
        from,
      )({
        kind: 'property',
        propertyId,
      }),
    },
    timezone: facts.timezone,
  }
}

export async function readPortalGoalAddOptions(
  deps: PortalGoalAddOptionsDeps,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<PortalGoalAddOptions> {
  const { organizationId } = actor
  const { propertyId } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  const now = deps.now()
  const [programs, facts] = await Promise.all([
    deps.reads.list(propertyId, actor),
    gatherPortalGoalFacts(deps.recommendation, { organizationId, propertyId, now }),
  ])
  const basis = portalGoalAddBasisOf(facts, recommendationFrom(facts))
  const groups = await namedGroups(deps, groupIdsOf(basis), {
    organizationId,
    propertyId,
  })
  return portalGoalAddOptionsOf(basis, { propertyId, programs, groups })
}
