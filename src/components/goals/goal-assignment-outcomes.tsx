import type {
  GoalAssignmentChangeOutcome,
  GoalSubject,
} from '#/contexts/goal/application/public-api'
import { goalSubjectKey } from './goal-subject-picker'

export function GoalAssignmentOutcomes({
  outcomes,
  effectiveFrom,
  subjectLabel,
}: Readonly<{
  outcomes: readonly GoalAssignmentChangeOutcome[]
  effectiveFrom: Date | null
  subjectLabel: (subject: GoalSubject) => string
}>) {
  return (
    <section className="space-y-2 rounded-md bg-muted/50 p-3" aria-live="polite">
      <h3 className="text-sm font-medium">Assignment results</h3>
      {effectiveFrom ? (
        <p className="text-xs text-muted-foreground">
          Scheduled from {effectiveFrom.toLocaleDateString()}.
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
