// The strip a goal's check-in is drawn in, above its card (ADR 0068, amended
// 2026-10-19: one goal design system): a notice named by its title, a headline
// that says how the last stretch went, a line under it, the choices the manager
// has (the first marked as the one to take) and the one line that nothing changes
// unless they choose. It is a labelled region and not a live region around a few
// buttons, so a page that loads with it says it in turn. Nothing here sends
// anything: each choice is the goal's own command, and a refusal is the goal's to
// say (`error` draws it in the strip; a goal that says it in a toast passes none).
// A goal passes its words and its commands; this part holds none of either.
import { useId, type ReactNode } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'

type CheckInProps = Readonly<{
  /** The strip's `data-slot`: how a story, a test and a journey find it. */
  slot: string
  /** The region's name, which is also its title. */
  label: string
  /** How the last stretch went, in one line; none where there is nothing to say. */
  headline: string | null
  /** The line under it: what is offered, and anything that explains it. */
  sub: ReactNode
  /** The choices in the order they are drawn, one a tap target each. */
  choices: ReadonlyArray<
    Readonly<{
      key: string
      label: string
      /** The one to take; drawn as the filled button. */
      primary?: boolean
      /** This choice is on its way: its button shows it and says so. */
      pending?: boolean
      onPress: () => void
    }>
  >
  /** A choice is on its way: none can be pressed again. */
  busy: boolean
  /** The line that nothing changes unless the manager chooses. */
  note: string
  /** A refusal to say in the strip; left out where the goal says it elsewhere. */
  error?: unknown
}>

export function GoalCheckIn({
  slot,
  label,
  headline,
  sub,
  choices,
  busy,
  note,
  error,
}: CheckInProps) {
  const labelId = useId()
  return (
    <Alert variant="info" role="region" aria-labelledby={labelId} data-slot={slot}>
      <AlertTitle id={labelId}>{label}</AlertTitle>
      <AlertDescription className="gap-2">
        {headline === null ? null : (
          <p className="text-base font-semibold text-foreground">{headline}</p>
        )}
        <p>{sub}</p>
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.key}
              variant={choice.primary ? 'default' : 'outline'}
              touch
              pending={choice.pending}
              pendingLabel="Saving…"
              disabled={busy}
              onClick={choice.onPress}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <p>{note}</p>
        <FormErrorBanner error={error} />
      </AlertDescription>
    </Alert>
  )
}

/**
 * The goal's card with its check-in strip above it while one is due; the card
 * alone, drawn as it always is, when `checkIn` is null.
 */
export function GoalWithCheckIn({
  checkIn,
  children,
}: Readonly<{ checkIn: ReactNode; children: ReactNode }>) {
  if (checkIn === null) return <>{children}</>
  return (
    <div className="flex flex-col gap-3">
      {checkIn}
      {children}
    </div>
  )
}
