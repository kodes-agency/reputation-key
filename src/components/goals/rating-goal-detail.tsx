// The Google rating goal's detail page, one click from its card (2026-11-01, ADR
// 0067): where the goal stands on the setup's ruler, then three questions in the
// bands Guest voice and Portal Results use: is the rating going up (a plain line to
// the goal), are enough good reviews coming in (bars against the plan), and what can
// you do this week. "What happened" is closed until asked. A goal this read found
// ended says so first and looks forward no more.
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { GoalDetailLayout } from './goal-detail-layout'
import { RatingGoalBands, RatingGoalKeepBand } from './rating-goal-bands'
import { RatingGoalDetailHeader } from './rating-goal-detail-header'
import { freshnessText } from './rating-goal-detail-view'
import { RatingGoalMovedList } from './rating-goal-moved-list'
import { endedSentence } from './rating-goal-view'

type Props = Readonly<{
  /** The low reviews open in this Property's Inbox. */
  propertyId: string
  detail: RatingGoalDetailView
  /** When the detail was read: Google's numbers are "checked N minutes ago" from it. */
  readAt: Date
  timezone: string
  now: Date
  personName: (userId: string) => string | null
  /** Opens the change of plan; none where this viewer may not change it. */
  onChangePlan?: () => void
}>

/** Said once, first, when the read found the goal ended. */
function Ended({ detail }: Pick<Props, 'detail'>) {
  if (detail.state !== 'ended') return null
  return (
    <Alert variant="info">
      <AlertDescription>
        {endedSentence(detail.endedReason)}. It is in History now, and you can set a new
        goal on the Goals page.
      </AlertDescription>
    </Alert>
  )
}

/** How fresh Google's numbers are, and who sees this page. */
function Foot({ detail, readAt }: Pick<Props, 'detail' | 'readAt'>) {
  return (
    <p className="text-xs text-muted-foreground">
      {detail.google === null
        ? 'Google’s numbers are not in yet'
        : freshnessText(detail.google.asOf, readAt)}
      {' · '}Owners and managers only
    </p>
  )
}

export function RatingGoalDetail(props: Props) {
  const { detail, propertyId, timezone, now, personName, onChangePlan, readAt } = props
  return (
    <GoalDetailLayout slot="rating-goal-detail">
      <Ended detail={detail} />
      <RatingGoalDetailHeader detail={detail} timezone={timezone} now={now} />
      {detail.mode === 'keep' ? (
        <RatingGoalKeepBand detail={detail} timezone={timezone} now={now} />
      ) : (
        <RatingGoalBands
          detail={detail}
          propertyId={propertyId}
          timezone={timezone}
          now={now}
          onChangePlan={onChangePlan}
        />
      )}
      <RatingGoalMovedList
        propertyId={propertyId}
        detail={detail}
        personName={personName}
        timezone={timezone}
        now={now}
      />
      <Foot detail={detail} readAt={readAt} />
    </GoalDetailLayout>
  )
}

/** The page of a Property with no active rating goal: the way back to set one. */
export function RatingGoalMissing({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <EmptyState
      icon={Target}
      title="This property has no Google rating goal"
      description="Set one on the Goals page."
      action={
        <Button asChild variant="outline">
          <Link to="/properties/$propertyId/goals" params={{ propertyId }}>
            Go to goals
          </Link>
        </Button>
      }
    />
  )
}
