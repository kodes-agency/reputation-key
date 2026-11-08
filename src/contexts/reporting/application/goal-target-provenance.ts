// A subject-only revision does not reset when the target was set. Walk back
// through unchanged measure/target pairs to find the start of that target.

import type {
  GoalMonthlyResult,
  GoalProgramVersion,
} from './ports/goal-program.repository'

export type GoalTargetProvenance = Readonly<{
  /** When the measure and target in force under the version were set. */
  setAt: Date
  /** The person who set them. */
  setBy: string
  /**
   * The first month counted against them: the first month with a result, or
   * the planned start while no month has opened yet. A plan replaced before
   * it began is not a start.
   */
  countsFrom: Date
}>

type ProvenanceSource = Readonly<{
  targetProvenance?: Readonly<Record<string, GoalTargetProvenance>>
  versions: readonly GoalProgramVersion[]
  results: readonly Pick<GoalMonthlyResult, 'programVersionId' | 'periodStart'>[]
}>

/**
 * The versions that carry the same measure and target as `version`, without a
 * break, ending at `version` itself. Oldest first.
 */
function unchangedRun(
  versions: readonly GoalProgramVersion[],
  version: GoalProgramVersion,
): readonly GoalProgramVersion[] {
  const earlier = versions
    .filter((candidate) => candidate.version < version.version)
    .sort((left, right) => right.version - left.version)
  const run = [version]
  for (const candidate of earlier) {
    if (
      candidate.metric !== version.metric ||
      candidate.targetValue !== version.targetValue
    ) {
      break
    }
    run.unshift(candidate)
  }
  return run
}

/**
 * True for a plan replaced or ended before any month opened under it: its
 * window ends where it starts, so it never counted for a month.
 */
const neverInForce = (candidate: GoalProgramVersion): boolean =>
  candidate.effectiveTo !== null && candidate.effectiveTo <= candidate.effectiveFrom

export function goalTargetProvenance(
  bundle: ProvenanceSource,
  version: GoalProgramVersion,
): GoalTargetProvenance {
  const captured = bundle.targetProvenance?.[version.id]
  if (captured) return captured
  const run = unchangedRun(bundle.versions, version)
  const first = run.at(0) ?? version
  // The plan the run first counts under. A replaced plan still says who set
  // the target and when, but its start is not a month anything counted from.
  const planned = run.find((candidate) => !neverInForce(candidate)) ?? version
  const runIds = new Set(run.map((candidate) => candidate.id))
  const firstMonth = bundle.results
    .filter((result) => runIds.has(result.programVersionId))
    .reduce<Date | null>(
      (earliest, result) =>
        earliest === null || result.periodStart < earliest
          ? result.periodStart
          : earliest,
      null,
    )
  return {
    setAt: first.createdAt,
    setBy: first.createdBy,
    countsFrom: firstMonth ?? planned.effectiveFrom,
  }
}
