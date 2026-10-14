// The wizard's last screen and its keep step. Done says what was set in two or
// three lines and offers ONE next step: a Portal when the Property has none,
// otherwise its portal goals. No number is carried over to Portal goals, which
// stay Google-free (ADR 0067). The keep step is the whole wizard for a goal that
// keeps the number Google shows: one sentence and "Start watching".
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { TONE_INK } from '#/components/ui/tone'
import type { RatingGoalReceipt } from './rating-goal-wizard-view'

export function RatingGoalDone({
  receipt,
  propertyId,
  hasPortals,
}: Readonly<{ receipt: RatingGoalReceipt; propertyId: string; hasPortals: boolean }>) {
  return (
    <>
      <div className="flex flex-col items-start gap-2">
        <CircleCheck aria-hidden="true" className={`size-10 ${TONE_INK.positive}`} />
        <p className="text-3xl leading-none font-semibold tabular-nums">
          {receipt.headline}
        </p>
        {receipt.pace === null ? null : <p className="text-base">{receipt.pace}</p>}
        {receipt.forecast === null ? null : (
          <p className="text-sm text-muted-foreground">{receipt.forecast}</p>
        )}
      </div>
      <DialogFooter className="mt-auto">
        <DialogCancel>Go to goals</DialogCancel>
        <Button asChild>
          {hasPortals ? (
            <Link
              to="/properties/$propertyId/goals/new"
              params={{ propertyId }}
              search={{ mode: 'several' }}
            >
              Set portal goals
            </Link>
          ) : (
            <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
              Create a portal
            </Link>
          )}
        </Button>
      </DialogFooter>
    </>
  )
}

export function RatingGoalKeepStep({
  kept,
  googleLine,
  pending,
  banner,
  onStart,
}: Readonly<{
  /** "4.9" */
  kept: string
  /** "Google shows 4.9 from 50 reviews", when Google's numbers are in. */
  googleLine: string | null
  pending: boolean
  /** The save's refusal, directly above the actions. */
  banner: ReactNode
  onStart: () => void
}>) {
  return (
    <>
      <div className="flex flex-col gap-2">
        {googleLine === null ? null : (
          <p className="text-sm text-muted-foreground">{googleLine}</p>
        )}
        <p className="text-base">
          We watch that Google keeps showing {kept}. The goal reads Holding while it does,
          and Dropped below if it slips.
        </p>
      </div>
      {banner}
      <DialogFooter className="mt-auto">
        <DialogCancel />
        <Button pending={pending} onClick={onStart}>
          Start watching
        </Button>
      </DialogFooter>
    </>
  )
}
