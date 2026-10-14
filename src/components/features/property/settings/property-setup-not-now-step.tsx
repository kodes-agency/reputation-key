// A setup step that may be put off: its link, and "Not now" beside it. Only
// the Google rating goal step is (owner, 2026-10-14): "Not now" then counts it
// as decided, so the strip stops reminding. Apart from the strip, whose
// waiting chip draws its own spinner, so a pending Button here is the
// Button's own.
import type { ReactNode } from 'react'
import type { PropertySetupStep } from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'
import { propertySetupStepLabel } from './property-setup-steps'

/** "Not now" for the Google rating goal step: it then counts as decided. */
export type RatingGoalNotNow = Readonly<{ choose: () => void; pending: boolean }>

export function PropertySetupNotNowStep({
  step,
  notNow,
  link,
}: Readonly<{ step: PropertySetupStep; notNow: RatingGoalNotNow; link: ReactNode }>) {
  return (
    <span className="inline-flex items-center gap-1">
      {link}
      <Button
        variant="ghost"
        size="xs"
        touch
        pending={notNow.pending}
        aria-label={`Not now: ${propertySetupStepLabel(step)}`}
        onClick={notNow.choose}
      >
        Not now
      </Button>
    </span>
  )
}
