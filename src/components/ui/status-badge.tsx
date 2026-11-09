import { Circle, type LucideIcon } from 'lucide-react'

import { Badge } from './badge'
import { TONE_ICON, type Tone } from './tone'

// A domain status as a pill. A feature writes its words once, as a StatusMap, and
// the badge takes the tone, the tone's icon and the label from it:
//
//   const GOAL_STATUS: StatusMap<GoalStatus> = {
//     active: { label: 'Active', tone: 'positive' },
//     ended: { label: 'Ended', tone: 'neutral' },
//   }
//   <StatusBadge status={program.status} map={GOAL_STATUS} />
//
// The map is typed over the whole status union, so a new status will not build until
// it is labelled; a value that escapes the types (a server newer than the page)
// reads as a neutral "Unknown", never as the token. A state with no enum takes
// `tone` and `label` directly. Icons are hidden from the accessibility tree: the
// label says it.

export type StatusTone = Exclude<Tone, 'info'>

export type StatusPresentation = Readonly<{ label: string; tone: StatusTone }>

/** Every status of a domain, labelled once. */
export type StatusMap<Status extends string> = Readonly<
  Record<Status, StatusPresentation>
>

const STATUS_ICON: Readonly<Record<StatusTone, LucideIcon>> = {
  positive: TONE_ICON.positive,
  warn: TONE_ICON.warn,
  negative: TONE_ICON.negative,
  neutral: Circle,
}

const UNKNOWN_STATUS: StatusPresentation = { label: 'Unknown', tone: 'neutral' }

type StatusBadgeProps = Readonly<{ className?: string; wrap?: boolean }> &
  (
    | Readonly<{
        /** A string, not the map's union: a row from a server newer than the page reads as "Unknown". */
        status: string
        map: Readonly<Record<string, StatusPresentation>>
      }>
    | Readonly<{ tone: StatusTone; label: string }>
  )

/** The map's own entry for a status, never one inherited from Object.prototype. */
function presentationOf(
  map: Readonly<Record<string, StatusPresentation>>,
  status: string,
): StatusPresentation {
  return (Object.hasOwn(map, status) ? map[status] : undefined) ?? UNKNOWN_STATUS
}

export function StatusBadge({ className, wrap, ...source }: StatusBadgeProps) {
  const { label, tone }: StatusPresentation =
    'map' in source ? presentationOf(source.map, source.status) : source
  const Icon = STATUS_ICON[tone]
  return (
    <Badge variant={tone} wrap={wrap} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
