import { Circle, type LucideIcon } from 'lucide-react'

import { Badge } from './badge'
import { TONE_ICON, type Tone } from './tone'

// A domain status as a pill (UI consistency scan: COLL-05). The status reached
// the screen as a raw token (`active`, `reauth_required`, `AccountAdmin`) in a
// badge whose colour was the author's pick, so the same state looked different
// on every page. A feature writes its words once, as a StatusMap, and the badge
// takes the tone, the one icon that tone wears, and the label from it:
//
//   const GOAL_STATUS: StatusMap<GoalStatus> = {
//     active: { label: 'Active', tone: 'positive' },
//     ended: { label: 'Ended', tone: 'neutral' },
//   }
//   <StatusBadge status={program.status} map={GOAL_STATUS} />
//
// The map is typed over the whole status union, so a new status will not build
// until it is labelled; a value that still escapes the types (a server newer than
// the page) reads as a neutral "Unknown", never as the token. A state with no
// enum behind it takes `tone` and `label` directly. Icons are hidden from the
// accessibility tree: the label says it, the icon and tint only help a glance.
//
//   positive  CircleCheck    warn  TriangleAlert    negative  CircleAlert
//   neutral   Circle (a quiet ring)

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

type StatusBadgeProps = Readonly<{ className?: string }> &
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

export function StatusBadge({ className, ...source }: StatusBadgeProps) {
  const { label, tone }: StatusPresentation =
    'map' in source ? presentationOf(source.map, source.status) : source
  const Icon = STATUS_ICON[tone]
  return (
    <Badge variant={tone} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
