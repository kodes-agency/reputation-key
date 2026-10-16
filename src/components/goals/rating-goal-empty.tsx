// The Google section of the Goals page when the Property has no rating goal: the
// door into the setup, the "keep" door when Google shows 4.9 or 5.0 and there
// is no higher tenth to climb to (round 2, R2-9), or the plain reason a goal
// cannot be set yet (ADR 0067; plan, Edge cases).
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
  /** Too few reviews links to the Portals, or to a first Portal when there is none. */
  hasPortals: boolean
  onStart: (intent: RatingGoalWizardIntent) => void
}>

/** "Google shows 4.3 from 812 reviews." */
function googleSentence(setup: RatingGoalSetupView): string | null {
  const google = setup.google
  if (google === null || google.shows === null) return null
  return `Google shows ${ratingText(google.shows)} from ${reviewsText(google.reviewCount)}.`
}

/**
 * Why there is no goal to set yet, in one title and one sentence. Too few
 * reviews says only the count: never a number of reviews to go and ask for.
 */
function NotEligible({ setup, propertyId, hasPortals }: Omit<Props, 'onStart'>) {
  const { eligibility } = setup
  if (eligibility.eligible) return null
  if (eligibility.reason === 'few_reviews') {
    return (
      <EmptyState
        icon={Target}
        title="Rating goals start at 10 Google reviews"
        description={`You have ${eligibility.reviewCount}.`}
        action={
          <Button asChild variant="outline">
            {hasPortals ? (
              <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
                Go to portals
              </Link>
            ) : (
              <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
                Create a portal
              </Link>
            )}
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

export function RatingGoalEmpty({ setup, propertyId, hasPortals, onStart }: Props) {
  const { can } = usePermissions()
  if (!setup.eligibility.eligible)
    return <NotEligible setup={setup} propertyId={propertyId} hasPortals={hasPortals} />
  const google = googleSentence(setup)
  const shows = setup.google?.shows ?? null
  const readOnly = (
    <p className="text-sm text-muted-foreground">
      You can’t set goals for this property.
    </p>
  )
  if (setup.offerKeepFirst && shows !== null) {
    const kept = ratingText(shows)
    return (
      <EmptyState
        icon={Target}
        title={`Keep ${kept} on Google`}
        description={[
          google,
          'There’s no higher number to aim for, so the goal is to keep it.',
        ]
          .filter(Boolean)
          .join(' ')}
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
        'We suggest a number Google can show and how many new reviews a day get you there.',
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
