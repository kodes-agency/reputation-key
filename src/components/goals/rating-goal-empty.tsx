// The Google section of the Goals page when the Property has no rating goal: the
// door into the wizard, the "keep" door when there is no higher tenth to climb
// to, or the plain reason a goal cannot be set yet (ADR 0067; plan, Edge cases).
// It leads with one sentence and one action, as every first-time screen must.
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ratingText, reviewsText } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

type Props = Readonly<{
  setup: RatingGoalSetupView
  propertyId: string
  onStart: (intent: RatingGoalWizardIntent) => void
}>

/** "Google shows 4.3 from 812 reviews." */
function googleSentence(setup: RatingGoalSetupView): string | null {
  const google = setup.google
  if (google === null || google.shows === null) return null
  return `Google shows ${ratingText(google.shows)} from ${reviewsText(google.reviewCount)}.`
}

/** Why there is no goal to set yet, in one title and one sentence. */
function NotEligible({ setup, propertyId }: Omit<Props, 'onStart'>) {
  const { eligibility } = setup
  if (eligibility.eligible) return null
  if (eligibility.reason === 'few_reviews') {
    return (
      <EmptyState
        icon={Target}
        title="Rating goals start at 10 Google reviews"
        description={`You have ${eligibility.reviewCount}. Your portals invite guests to leave one.`}
        action={
          <Button asChild variant="outline">
            <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
              Go to portals
            </Link>
          </Button>
        }
      />
    )
  }
  if (eligibility.reason === 'property_not_active') {
    return (
      <EmptyState
        icon={Target}
        title="Rating goals need an active property"
        description="This property isn’t active, so it can’t have a Google rating goal."
      />
    )
  }
  return (
    <EmptyState
      icon={Target}
      title="Waiting for Google’s numbers"
      description="A rating goal starts from the rating and review count Google shows. They aren’t in yet, or they are more than a day old."
      action={
        <Button asChild variant="outline">
          <Link to="/properties/$propertyId/google" params={{ propertyId }}>
            Check the Google connection
          </Link>
        </Button>
      }
    />
  )
}

export function RatingGoalEmpty({ setup, propertyId, onStart }: Props) {
  const { can } = usePermissions()
  if (!setup.eligibility.eligible)
    return <NotEligible setup={setup} propertyId={propertyId} />
  const google = googleSentence(setup)
  const shows = setup.google?.shows ?? null
  const readOnly = (
    <p className="text-sm text-muted-foreground">
      You can’t set goals for this property.
    </p>
  )
  if (setup.offerKeepFirst && shows !== null) {
    const kept = ratingText(shows)
    const why =
      setup.stops.length === 0
        ? 'There’s no higher number to aim for, so the goal is to keep it.'
        : 'A higher number isn’t reachable at your recent star mix, so the goal is to keep it.'
    return (
      <EmptyState
        icon={Target}
        title={`Keep ${kept} on Google`}
        description={[google, why].filter(Boolean).join(' ')}
        action={
          can('goal.create') ? (
            <Button
              onClick={() =>
                onStart({ kind: 'keep', targetTenths: Math.round(shows * 10) })
              }
            >
              {`Keep ${kept} on Google`}
            </Button>
          ) : (
            readOnly
          )
        }
      />
    )
  }
  return (
    <EmptyState
      icon={Target}
      title="Set your Google rating goal"
      description={[
        google,
        'Pick the number you want it to show and a weekly pace to get there.',
      ]
        .filter(Boolean)
        .join(' ')}
      action={
        can('goal.create') ? (
          <Button onClick={() => onStart({ kind: 'climb' })}>Set goal</Button>
        ) : (
          readOnly
        )
      }
    />
  )
}
