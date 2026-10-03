import type { StatusMap, StatusPresentation } from '#/components/ui/status-badge'
import type { GoalProgram } from '#/contexts/reporting/application/public-api'

/** How a goal program's status reads as a pill, on the list and on the goal. */
export const GOAL_STATUS: StatusMap<GoalProgram['status']> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'warn' },
  ended: { label: 'Ended', tone: 'neutral' },
}

/** Why a month has no verdict; every other state is a gap in the data, not a miss. */
const NO_VERDICT: Readonly<Record<string, StatusPresentation>> = {
  insufficient_data: { label: 'More ratings needed', tone: 'neutral' },
  updating: { label: 'Updating', tone: 'neutral' },
  quarantined: { label: 'Needs review', tone: 'warn' },
}

const UNAVAILABLE: StatusPresentation = { label: 'Unavailable', tone: 'neutral' }

/**
 * A month's result as a pill: achieved or not once it could be judged,
 * otherwise the reason it could not. A correction says so in the label.
 */
export function goalResultStatus(
  evaluation: Readonly<{ state: string; achieved?: boolean | null }>,
  corrected: boolean,
): StatusPresentation {
  const base: StatusPresentation =
    evaluation.state === 'eligible'
      ? evaluation.achieved
        ? { label: 'Achieved', tone: 'positive' }
        : { label: 'Not achieved', tone: 'negative' }
      : (NO_VERDICT[evaluation.state] ?? UNAVAILABLE)
  return corrected ? { ...base, label: `Corrected · ${base.label}` } : base
}
