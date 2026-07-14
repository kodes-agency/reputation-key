// Shared primitives for the goal-create flow: the selectable ChoiceTile, a
// SectionCard wrapper, icon maps, and the timeframe-default helper. Extracted
// so each section file stays under the 150-line component limit.
import type { ComponentType } from 'react'
import {
  Building2,
  QrCode,
  Layers,
  Star,
  MessageSquare,
  MousePointerClick,
  Globe,
  CalendarClock,
  RefreshCw,
  Timer,
  Infinity as InfinityIcon,
  Check,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import type { ReactNode } from 'react'
import type {
  MetricKey,
  AggregationFunction,
  EntityScope,
} from '#/shared/domain/metric-keys'
import type { FormState } from './go-create-form-state'

type Icon = ComponentType<{ className?: string }>

export const METRIC_ICONS: Readonly<Record<MetricKey, Icon>> = {
  'portal.scan': QrCode,
  'portal.rating': Star,
  'portal.feedback': MessageSquare,
  'portal.review_link_click': MousePointerClick,
  'property.review': Globe,
}

export const SCOPE_ICONS: Readonly<Record<EntityScope, Icon>> = {
  property: Building2,
  portal: QrCode,
  portal_group: Layers,
}

export const TIMEFRAME_ICONS: Readonly<Record<FormState['goalType'], Icon>> = {
  one_shot: CalendarClock,
  recurring: RefreshCw,
  rolling: Timer,
  open: InfinityIcon,
}

export const SCOPES: readonly EntityScope[] = ['property', 'portal', 'portal_group']
export const TIMEFRAMES: readonly FormState['goalType'][] = [
  'one_shot',
  'recurring',
  'rolling',
  'open',
]

// Aggregations rendered as friendly verbs (used by the rating target section).
export const AGG_VERB: Readonly<Record<AggregationFunction, string>> = {
  avg: 'Average',
  max: 'Highest',
  count: 'Number of',
  sum: 'Total',
}

/** A titled card grouping one step of the form. */
export function SectionCard({
  title,
  description,
  children,
}: Readonly<{ title: string; description: string; children: ReactNode }>) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

/** Selectable tile used for scope / metric / timeframe choices. */
export function ChoiceTile({
  selected,
  onClick,
  title,
  description,
  icon: Icon,
}: Readonly<{
  selected: boolean
  onClick: () => void
  title: string
  description?: string
  icon?: Icon
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'border-border hover:bg-muted',
      )}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-primary" />}
      <span className="min-w-0 space-y-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {title}
          {selected && <Check className="size-3.5 text-primary" />}
        </span>
        {description && (
          <span className="block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </button>
  )
}

/** This-month range as datetime-local strings, for the one-shot default. */
export function thisMonthRange(): Readonly<{ start: string; end: string }> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  return {
    start: fmt(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0)),
    end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59)),
  }
}
