import type {
  GoalAssignmentChangeOutcome,
  GoalSubject,
} from '#/contexts/reporting/application/public-api'
import { goalSubjectKey } from './goal-subject-picker'
import { goalRevisionReceipt } from './goal-revision-start'

export function GoalAssignmentOutcomes({
  outcomes,
  effectiveFrom,
  propertyTimezone,
  now,
  subjectLabel,
}: Readonly<{
  outcomes: readonly GoalAssignmentChangeOutcome[]
  /** The start the command answered; null when nothing was changed. */
  effectiveFrom: Date | null
  /** The zone the version was cut in: `effectiveFrom` starts a month there. */
  propertyTimezone: string
  /** The reader's clock: the start prints its year once it is another one. */
  now: Date
  subjectLabel: (subject: GoalSubject) => string
}>) {
  return (
    <section className="space-y-2 rounded-md bg-muted/50 p-3" aria-live="polite">
      <h3 className="text-sm font-medium">Assignment results</h3>
      {effectiveFrom ? (
        // The receipt the revision dialog prints: one sentence and one date
        // rule for a saved change, whichever dialog saved it.
        <p className="text-xs text-muted-foreground">
          {goalRevisionReceipt({ effectiveFrom, propertyTimezone }, now)}
        </p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {outcomes.map((item, index) => (
          <li key={`${item.operation}:${goalSubjectKey(item.subject)}:${index}`}>
            {subjectLabel(item.subject)} — {outcomeLabel(item)}
          </li>
        ))}
      </ul>
    </section>
  )
}

function outcomeLabel(item: GoalAssignmentChangeOutcome): string {
  const labels: Record<GoalAssignmentChangeOutcome['outcome'], string> = {
    added: 'will be added',
    removed: 'will be removed',
    already_assigned: 'already assigned',
    not_assigned: 'was not assigned',
    duplicate: 'duplicate selection ignored',
    conflicting_operations: 'kept unchanged because add and remove both appeared',
    invalid_subject: 'not part of this property',
    overlap: 'already covered by another Goal Program for this measure',
    last_assignment_required: 'kept because a Goal Program needs a subject',
  }
  return labels[item.outcome]
}
