// The setup checklist, sized to its lifespan (redesign row 3).
//
// The full panel sat above the fold of the fleet dashboard on every visit — for
// an organization with thirteen properties and two of four milestones reached,
// it was the first thing a manager saw, every day, indefinitely. It is useful
// exactly until it is done, so it is one line with the next step and its action,
// and it disappears when the checklist completes.
//
// The panel itself survives for the one-property landing, which is the state it
// was designed for: nothing else on that page yet.
import { Check } from 'lucide-react'
import type { SetupChecklist } from '#/contexts/reporting/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { SetupChecklistActionLink } from './setup-checklist-action-link'

const STEP_TITLE = {
  google_connection: 'Connect Google',
  initial_review_sync: 'Complete the first review sync',
  published_portal: 'Publish a guest portal',
  responsible_managers: 'Assign responsible managers',
} as const

export function SetupChecklistBanner({
  checklist,
}: Readonly<{ checklist: SetupChecklist }>) {
  if (checklist.state === 'complete') return null

  const completed = checklist.steps.filter(
    (step) => step.firstCompletedAt !== null,
  ).length
  // The step a manager can act on now — not merely the first incomplete one,
  // which may be waiting on an account admin or on a sync finishing.
  const actionable = checklist.steps.find(
    (step) => step.status !== 'complete' && step.action !== null,
  )
  const next = actionable ?? checklist.steps.find((step) => step.status !== 'complete')
  if (!next) return null

  return (
    <Alert>
      <Check aria-hidden="true" />
      <AlertTitle>
        Setup: {completed} of {checklist.steps.length} done
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>Next: {STEP_TITLE[next.key]}.</span>
        {actionable?.action ? (
          <SetupChecklistActionLink action={actionable.action} />
        ) : (
          <span className="text-muted-foreground">
            {next.status === 'waiting'
              ? 'Waiting for an account admin.'
              : 'Nothing to do yet — this completes on its own.'}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
