import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { PropertySetupFns } from './property-setup-contract'
import type { SetupTaskKind, SetupTaskResult } from './run-setup-plan'
import { SetupAnalysisProgress } from './setup-analysis-progress'
import type { SetupPlan } from './setup-plan'

type Props = Readonly<{
  plan: SetupPlan
  results: readonly SetupTaskResult[]
  retrying: boolean
  onRetry: () => void
  getReviewAnalysisProgress: PropertySetupFns['getReviewAnalysisProgress']
}>

const TASK_LABEL: Readonly<Record<SetupTaskKind, string>> = {
  language: 'Reply language',
  managers: 'Responsible manager',
  ai: 'AI features',
}

export function SetupResults({
  plan,
  results,
  retrying,
  onRetry,
  getReviewAnalysisProgress,
}: Props) {
  const names = new Map(
    plan.properties.map((entry) => [entry.propertyId, entry.propertyName]),
  )
  const failed = results.filter((result) => result.outcome === 'failed')
  const aiSaved = plan.properties.filter((entry) =>
    results.some(
      (result) =>
        result.propertyId === entry.propertyId &&
        result.kind === 'ai' &&
        result.outcome === 'saved' &&
        entry.ai === 'enable',
    ),
  )
  const skipped = plan.properties.some(
    (entry) => entry.language === null || entry.managerIds === null || entry.ai === null,
  )

  return (
    <section aria-labelledby="setup-results-title" className="flex flex-col gap-5">
      {failed.length === 0 ? (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle id="setup-results-title">Setup saved</AlertTitle>
          <AlertDescription>
            {skipped
              ? 'Anything you skipped or that was already set stays visible on each property’s setup checklist.'
              : 'Every property has its reply language, responsible manager and AI decision.'}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle id="setup-results-title">Some answers were not saved</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1">
              {failed.map((result) => (
                <li key={`${result.propertyId}:${result.kind}`}>
                  <span className="font-medium">{names.get(result.propertyId)}</span> ·{' '}
                  {TASK_LABEL[result.kind]}: {result.message}
                </li>
              ))}
            </ul>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={retrying}
                onClick={onRetry}
              >
                {retrying ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Try again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <SetupAnalysisProgress
        properties={aiSaved}
        getReviewAnalysisProgress={getReviewAnalysisProgress}
      />
    </section>
  )
}
