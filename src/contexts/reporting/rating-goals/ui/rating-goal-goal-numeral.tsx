// Use a fifty-digit tenths strip so 3.9 to 4.0 rolls forward; reduced motion stops it.
// Keep endpoint buttons pressable with aria-disabled so a press can explain the limit.
// One-off sizes stay inline to avoid growing the first-paint stylesheet.

import { useState, type KeyboardEvent, type Ref } from 'react'
import { GoalHeroStepper } from '#/components/goals/goal-setup-parts'

const WHOLE_DIGITS = Array.from({ length: 10 }, (_, digit) => digit)
/** Five runs of 0–9: the tenths strip moves by the goal in tenths. */
const TENTH_DIGITS = Array.from({ length: 50 }, (_, index) => index % 10)
const ROLL =
  'flex flex-col transition-transform duration-500 ease-out motion-reduce:transition-none'

type Props = Readonly<{
  targetTenths: number
  minTenths: number
  maxTenths: number
  labels: Readonly<{
    lower: string
    raise: string
    atLowest: boolean
    atHighest: boolean
  }>
  /** "Goal 4.1: 81 new reviews, in about 3 months at 1 a day". */
  say: string
  /**
   * What the polite live region speaks: the goal, or a hint at an end. It is
   * off while the number has the focus, whose `aria-valuetext` says the goal
   * then (an arrow key, Home, End, or a status link that moved the focus
   * here), so each change is said once (PLAN-R4 B.8).
   */
  live: string
  /** The number itself, for a link that takes the focus there when it goes. */
  spinRef: Ref<HTMLSpanElement>
  small: boolean
  onLower: () => void
  onRaise: () => void
  onGoTo: (tenths: number) => void
}>

/**
 * One digit column. `clipPath` hides the strip's other digits; `overflowY:
 * clip` also keeps them out of the scrollable area, so the dialog or the
 * phone sheet never scrolls into the empty space below a strip (up to 49em
 * of it at a low goal). Sideways the digit may still overhang its column.
 */
function Strip({ digits, at }: Readonly<{ digits: readonly number[]; at: number }>) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.64em',
        height: '1em',
        overflowY: 'clip',
        clipPath: 'inset(0 -0.15em)',
      }}
    >
      <span className={ROLL} style={{ transform: `translateY(${-at}em)` }}>
        {digits.map((digit, index) => (
          <span key={index} className="block text-center" style={{ height: '1em' }}>
            {digit}
          </span>
        ))}
      </span>
    </span>
  )
}

export function RatingGoalGoalNumeral({ spinRef, ...props }: Props) {
  const { targetTenths, minTenths, maxTenths, labels, small } = props
  const [focused, setFocused] = useState(false)
  const keys: Readonly<Record<string, number>> = {
    ArrowUp: targetTenths + 1,
    ArrowRight: targetTenths + 1,
    ArrowDown: targetTenths - 1,
    ArrowLeft: targetTenths - 1,
    Home: minTenths,
    End: maxTenths,
  }
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    props.onGoTo(next)
  }
  return (
    <>
      <GoalHeroStepper
        small={small}
        lower={{
          label: labels.lower,
          inert: labels.atLowest,
          onPress: props.onLower,
        }}
        raise={{
          label: labels.raise,
          inert: labels.atHighest,
          onPress: props.onRaise,
        }}
      >
        <span
          ref={spinRef}
          role="spinbutton"
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          data-autofocus=""
          aria-label="Goal on Google"
          aria-valuenow={targetTenths / 10}
          aria-valuemin={minTenths / 10}
          aria-valuemax={maxTenths / 10}
          aria-valuetext={props.say}
          onKeyDown={onKeyDown}
          className="focus-ring rounded-xl"
        >
          <span
            aria-hidden="true"
            className="display-title inline-flex leading-none font-bold"
            style={{ fontSize: small ? 88 : 128, height: '1em' }}
          >
            <Strip digits={WHOLE_DIGITS} at={Math.floor(targetTenths / 10)} />
            <span className="text-center" style={{ width: '0.26em' }}>
              .
            </span>
            <Strip digits={TENTH_DIGITS} at={targetTenths} />
          </span>
        </span>
      </GoalHeroStepper>
      <span
        data-slot="rating-goal-live"
        className="sr-only"
        aria-live={focused ? 'off' : 'polite'}
      >
        {props.live}
      </span>
    </>
  )
}
