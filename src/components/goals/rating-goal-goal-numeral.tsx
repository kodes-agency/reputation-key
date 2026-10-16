// The goal as the hero number of the one-screen setup (E2/E4): − and + either
// side, and the number itself a spinbutton (the arrows a tenth, Home and End
// the lowest and the highest goal). Its digits roll a step at a time on two
// strips, the tenths strip fifty digits long so 3.9 → 4.0 rolls forward and
// never rewinds; reduced motion stops the roll. At an end − or + stays
// pressable (`aria-disabled`) so the press can say why in the status line. The
// mock's one-off sizes (128 px, 88 px on a phone) are inline: a utility of its
// own would grow the one stylesheet every page loads first.
import type { KeyboardEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton } from '#/components/ui/icon-button'

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
  /** What the polite live region speaks: the goal, or a hint at an end. */
  live: string
  small: boolean
  onLower: () => void
  onRaise: () => void
  onGoTo: (tenths: number) => void
}>

function Strip({ digits, at }: Readonly<{ digits: readonly number[]; at: number }>) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.64em',
        height: '1em',
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

export function RatingGoalGoalNumeral(props: Props) {
  const { targetTenths, minTenths, maxTenths, labels, small } = props
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
      <div className="flex items-center" style={{ gap: small ? 16 : 40 }}>
        <IconButton
          label={labels.lower}
          size="icon-lg"
          variant="outline"
          className="rounded-full"
          aria-disabled={labels.atLowest}
          onClick={props.onLower}
        >
          <Minus aria-hidden="true" />
        </IconButton>
        <span
          role="spinbutton"
          tabIndex={0}
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
            className="display-title inline-flex leading-none font-bold tabular-nums"
            style={{ fontSize: small ? 88 : 128, height: '1em' }}
          >
            <Strip digits={WHOLE_DIGITS} at={Math.floor(targetTenths / 10)} />
            <span className="text-center" style={{ width: '0.26em' }}>
              .
            </span>
            <Strip digits={TENTH_DIGITS} at={targetTenths} />
          </span>
        </span>
        <IconButton
          label={labels.raise}
          size="icon-lg"
          variant="outline"
          className="rounded-full"
          aria-disabled={labels.atHighest}
          onClick={props.onRaise}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>
      <span className="sr-only" aria-live="polite">
        {props.live}
      </span>
    </>
  )
}
