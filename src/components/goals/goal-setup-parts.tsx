// The parts a goal's one-screen setup is drawn with (ADR 0068, amended 2026-10-19:
// one goal design system): the goal's number as the hero with − and + either
// side, the line under it, the muted panel holding the way to choose, the
// recommendation's tag, the quoted aside and the row of explanation links. A goal
// passes the number's own box, its words and its commands; nothing here holds
// either, so the same screen reads the same for every goal.
//
// The recommendation wears the link ink: the tag says which choice to take, as the
// headline's target says which figure a goal leads with. `GOAL_SETUP_LINK` is the
// ink and the touch height of a link in the explanation row, for the goal that
// draws its own trigger.
import { Fragment, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

/** One of the two steppers: its name, whether it does nothing now, and what a press does. */
type Step = Readonly<{
  label: string
  /**
   * It does nothing now (an end, or a save on its way). It stays in the tab order
   * and pressable (`aria-disabled`), so the focus is never lost on a press and a
   * goal can say why in its status line.
   */
  inert: boolean
  onPress: () => void
}>

/**
 * The goal's number between − and +, as the hero of the screen: the box is the
 * goal's own (`children`), so a number typed in and a number rolled by the
 * stepper keep their own keys. The one-off sizes of the figures (a phone's
 * smaller ones, the gap between them and the steppers) are the caller's inline
 * `style`: a utility of its own would grow the one stylesheet every page loads
 * first.
 */
export function GoalHeroStepper({
  small,
  lower,
  raise,
  children,
}: Readonly<{
  /** A phone: the smaller gap. */
  small: boolean
  lower: Step
  raise: Step
  children: ReactNode
}>) {
  return (
    <div className="flex items-center" style={{ gap: small ? 16 : 40 }}>
      <IconButton
        label={lower.label}
        size="icon-lg"
        variant="outline"
        className="rounded-full"
        aria-disabled={lower.inert}
        onClick={lower.onPress}
      >
        <Minus aria-hidden="true" />
      </IconButton>
      {children}
      <IconButton
        label={raise.label}
        size="icon-lg"
        variant="outline"
        className="rounded-full"
        aria-disabled={raise.inert}
        onClick={raise.onPress}
      >
        <Plus aria-hidden="true" />
      </IconButton>
    </div>
  )
}

/** "Recommended": the tag on the choice the goal's read recommends. */
export function GoalRecommendedTag({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-xs font-semibold text-link">{children}</span>
}

/**
 * One part of the line under the goal: the tag, plain words, or a link, a step
 * the manager can take from here (`action` is the goal's own).
 */
export type GoalStatusPart<Action> =
  | Readonly<{ kind: 'tag'; text: string }>
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'link'; text: string; action: Action }>

/** The line under the goal: its parts in their order, a quiet dot between them. */
export function GoalSetupStatusLine<Action>({
  slot,
  parts,
  small,
  live,
  disabled,
  onAction,
}: Readonly<{
  /** The line's `data-slot`: how a story, a test and a journey find it. */
  slot: string
  parts: readonly GoalStatusPart<Action>[]
  small: boolean
  /**
   * Whether a screen reader speaks the line as it changes. Left out, the goal
   * says it elsewhere (a live region of its own beside the number).
   */
  live?: 'polite' | 'off'
  /** A link cannot be pressed: the goal's save is on its way. */
  disabled?: boolean
  onAction: (action: Action) => void
}>) {
  return (
    <p
      data-slot={slot}
      aria-live={live}
      className={cn(
        'flex items-center gap-x-2 text-sm',
        small && 'flex-wrap justify-center text-center',
      )}
      style={{ minHeight: small ? 28 : 30 }}
    >
      {parts.map((part, index) => (
        <Fragment key={`${part.kind}-${part.text}`}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          ) : null}
          {part.kind === 'tag' ? (
            <GoalRecommendedTag>{part.text}</GoalRecommendedTag>
          ) : part.kind === 'text' ? (
            <span className="text-muted-foreground">{part.text}</span>
          ) : (
            <Button
              type="button"
              variant="link"
              size="inline"
              touch
              disabled={disabled}
              onClick={() => onAction(part.action)}
            >
              {part.text}
            </Button>
          )}
        </Fragment>
      ))}
    </p>
  )
}

/**
 * The muted panel the way to choose sits in. With a `label` it is a named
 * region; without, a plain block, for a panel whose own control already names
 * it (a region and a group of the same name in one dialog read twice).
 */
export function GoalSetupPanel({
  label,
  small,
  children,
}: Readonly<{ label?: string; small: boolean; children: ReactNode }>) {
  const className = cn(
    'flex w-full flex-col rounded-xl bg-muted',
    small ? 'px-4 py-3' : 'px-6 py-4',
  )
  const style = { maxWidth: 620 }
  return label === undefined ? (
    <div className={className} style={style}>
      {children}
    </div>
  ) : (
    <section aria-label={label} className={className} style={style}>
      {children}
    </section>
  )
}

/** A line quoted in the panel: how to ask, with an optional bold lead. */
export function GoalAside({
  lead,
  children,
}: Readonly<{ lead?: string; children: ReactNode }>) {
  return (
    <p
      className="mt-2 pl-3 text-xs text-muted-foreground"
      style={{ borderInlineStart: '2px solid var(--border)' }}
    >
      {lead === undefined ? null : (
        <>
          <b className="font-semibold text-foreground">{lead}</b>{' '}
        </>
      )}
      {children}
    </p>
  )
}

/** The ink and touch height of a link in the explanation row. */
export const GOAL_SETUP_LINK = 'text-link max-md:min-h-(--control-touch)'

/**
 * The row under the panel: one sentence on how the goal counts (left out on a
 * phone, where the room is short) and the links that explain it (`children`:
 * the goal's own triggers and whatever sits between them).
 */
export function GoalSetupLinks({
  sentence,
  small,
  children,
}: Readonly<{ sentence: string; small: boolean; children: ReactNode }>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-2 text-center text-sm text-muted-foreground',
        small && 'text-xs',
      )}
    >
      {small ? null : <span>{sentence}</span>}
      {children}
    </div>
  )
}
