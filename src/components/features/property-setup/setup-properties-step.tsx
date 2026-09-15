import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { aiKeys, identityKeys, propertyKeys } from '#/shared/queries/query-keys'
import type {
  PropertySetupFns,
  SetupImportedProperty,
  SetupMember,
} from './property-setup-contract'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import {
  failedSetupTasks,
  mergeSetupResults,
  runSetupPlan,
  type SetupTaskResult,
  type SetupWriteFns,
} from './run-setup-plan'
import {
  buildSetupPlan,
  initialSetupAnswers,
  type SetupAnswers,
  type SetupPropertyFacts,
} from './setup-plan'
import { SetupQuestionnaire, setupQuestionCount } from './setup-questionnaire'
import { SetupResults } from './setup-results'
import { SetupReview } from './setup-review'
import { useSetupFacts, type SetupFactsState } from './use-setup-facts'

type Props = Readonly<{
  properties: readonly SetupImportedProperty[]
  fns: PropertySetupFns
  viewerUserId: string
}>

function writeFnsFrom(fns: PropertySetupFns): SetupWriteFns {
  return {
    enableAi: (input) => fns.enableMerchantAiForProperties({ data: input }),
    deferAi: ({ propertyId }) => fns.deferMerchantAiDecision({ data: { propertyId } }),
    setLanguage: ({ propertyId, language }) =>
      fns.updateProperty({ data: { propertyId, defaultReplyLanguage: language } }),
    setManagers: async ({ propertyId, managerIds }) => {
      const state = await fns.listPropertyResponsibleManagers({ data: { propertyId } })
      // Someone assigned managers since the questions were asked: keep theirs.
      if (state.assignments.length > 0) return
      await fns.updatePropertyResponsibleManagers({
        data: {
          propertyId,
          managerUserIds: [...managerIds].sort(),
          expectedRevision: state.revision,
        },
      })
    },
  }
}

function SetupFlow({
  facts,
  members,
  notice,
  fns,
  viewerUserId,
}: Readonly<{
  facts: readonly SetupPropertyFacts[]
  members: ReadonlyMap<string, SetupMember>
  notice: MerchantAiNoticeDto
  fns: PropertySetupFns
  viewerUserId: string
}>) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'questions' | 'review' | 'results'>('questions')
  const [answers, setAnswers] = useState<SetupAnswers>(() =>
    initialSetupAnswers(facts, viewerUserId),
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<readonly SetupTaskResult[]>([])
  // One ceremony key for this setup: a retry replays a ceremony that committed.
  const [aiIdempotencyKey] = useState(() => crypto.randomUUID())
  const plan = useMemo(() => buildSetupPlan(facts, answers), [facts, answers])
  const writeFns = useMemo(() => writeFnsFrom(fns), [fns])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: propertyKeys.all }),
      queryClient.invalidateQueries({ queryKey: identityKeys.merchantAiOverview() }),
      ...facts.map((property) =>
        queryClient.invalidateQueries({
          queryKey: aiKeys.reviewAnalysisProgress(property.propertyId),
        }),
      ),
    ])
  }

  const save = async (retryOnly: readonly SetupTaskResult[] | null) => {
    setSaving(true)
    try {
      const failed = new Set(retryOnly?.map((task) => `${task.propertyId}:${task.kind}`))
      const next = await runSetupPlan(plan, writeFns, {
        acknowledgement: acknowledged
          ? { noticeVersion: notice.version, noticeDigest: notice.digest }
          : null,
        aiIdempotencyKey,
        include: retryOnly
          ? (propertyId, kind) => failed.has(`${propertyId}:${kind}`)
          : undefined,
      })
      setResults((previous) => (retryOnly ? mergeSetupResults(previous, next) : next))
      setPhase('results')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'results') {
    return (
      <SetupResults
        plan={plan}
        results={results}
        retrying={saving}
        onRetry={() => void save(failedSetupTasks(results))}
        getReviewAnalysisProgress={fns.getReviewAnalysisProgress}
      />
    )
  }
  if (phase === 'review') {
    return (
      <SetupReview
        plan={plan}
        facts={facts}
        members={members}
        notice={notice}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        saving={saving}
        onBack={() => setPhase('questions')}
        onSave={() => void save(null)}
      />
    )
  }
  return (
    <SetupQuestionnaire
      facts={facts}
      members={members}
      notice={notice}
      answers={answers}
      onAnswersChange={(next) => {
        setAnswers(next)
        // Consent covers exactly what was reviewed; a changed answer asks again.
        setAcknowledged(false)
      }}
      onReview={() => setPhase('review')}
    />
  )
}

/**
 * The questions are asked about the facts as they were when the step opened.
 * Saving refreshes every cache, and the answers would otherwise disappear
 * under the merchant as the refreshed facts report those steps complete.
 */
function SetupStepBody({
  ready,
  fns,
  viewerUserId,
}: Readonly<{
  ready: Extract<SetupFactsState, { status: 'ready' }>
  fns: PropertySetupFns
  viewerUserId: string
}>) {
  const [snapshot] = useState(ready)
  if (setupQuestionCount(snapshot.facts) === 0) {
    return (
      <Alert>
        <AlertTitle>Nothing left to ask</AlertTitle>
        <AlertDescription>
          These properties already have a reply language, a responsible manager and an AI
          decision.{' '}
          <Link to="/properties" className="font-medium underline underline-offset-4">
            View properties
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <SetupFlow
      facts={snapshot.facts}
      members={snapshot.members}
      notice={snapshot.notice}
      fns={fns}
      viewerUserId={viewerUserId}
    />
  )
}

/**
 * The wizard's last step (decisions 2, 3, 8): three questions answered once
 * for every property the import produced, then one review and one save.
 */
export function SetupPropertiesStep({ properties, fns, viewerUserId }: Props) {
  const state = useSetupFacts(properties, fns)

  return (
    <section
      aria-labelledby="setup-properties-title"
      className="flex flex-col gap-4 border-t pt-6"
    >
      <div>
        <h2 id="setup-properties-title" className="text-xl font-semibold tracking-tight">
          Set up properties
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A few answers finish setting up what you imported. Nothing here blocks the
          inbox.
        </p>
      </div>
      {state.status === 'loading' ? (
        <div
          aria-label="Loading setup questions"
          className="flex flex-col gap-3 rounded-xl border p-6"
        >
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : state.status === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Setup questions unavailable</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>Each property&apos;s setup checklist still lists what is left to do.</p>
            <div>
              <Button type="button" variant="outline" onClick={state.retry}>
                Try again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <SetupStepBody ready={state} fns={fns} viewerUserId={viewerUserId} />
      )}
    </section>
  )
}
