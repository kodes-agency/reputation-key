import { Fragment } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { ChangePill } from './guest-voice-words'

/** A count of reviews ("19 of 128") or a star figure ("2.1★"): what a line is about. */
const FIGURE = /(\d[\d,.]*★|\d[\d,]* of \d[\d,]*)/u

/**
 * A sentence with its figures set in the foreground ink and a heavier weight, so the
 * numbers are what the eye finds first. The words stay one string, spelled in one place
 * (`guest-voice-words`), and this only finds the figures in it.
 */
export function Figures({ children }: Readonly<{ children: string }>) {
  return children.split(FIGURE).map((part, index) =>
    index % 2 === 1 ? (
      <b key={index} className="font-medium text-foreground tabular-nums">
        {part}
      </b>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const

/** A change, in words, an arrow and a tone: colour is never the only thing that says it. */
export function ChangeBadge({ pill }: Readonly<{ pill: ChangePill }>) {
  const Icon = DIRECTION_ICON[pill.direction]
  return (
    <Badge variant={pill.tone}>
      <Icon aria-hidden="true" />
      {pill.label}
    </Badge>
  )
}
