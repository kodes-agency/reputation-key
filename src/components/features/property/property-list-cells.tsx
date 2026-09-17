// The Properties list's cells (docs/plan/property-list-table.md rows 4–8).
//
// Only the property name keeps the link accent: it is the row's one way to open
// the property. The attention and setup cells are links too, but figures must
// not turn purple (row 2 of the plan's findings), and the global `a` colour in
// styles.css is unlayered, so those links pin their ink with `!`.
import { Link } from '@tanstack/react-router'
import { Check, Link2Off, Star } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import {
  propertySetupStepLabel,
  propertySetupStepTarget,
} from './settings/property-setup-steps'
import {
  attentionQualifiers,
  attentionTarget,
  googleLinkNotice,
  type DataState,
  type PropertyComparison,
  type PropertyListRow,
  type PropertySetupProgress,
} from './property-list-view'

const FOCUS_RING =
  'rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function Pending({ className }: Readonly<{ className?: string }>) {
  return <Skeleton className={cn('h-4', className)} aria-hidden="true" />
}

export function PropertyNameCell({ row }: Readonly<{ row: PropertyListRow }>) {
  const { property } = row
  const notice = googleLinkNotice(property.googleBindingState)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/properties/$propertyId"
          params={{ propertyId: property.id }}
          className={cn('truncate font-medium', FOCUS_RING)}
        >
          {property.name}
        </Link>
        {row.paused ? <Badge variant="secondary">Paused</Badge> : null}
      </div>
      {row.country || notice ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {row.country ? <span className="truncate">{row.country}</span> : null}
          {notice ? (
            <Link
              to="/properties/$propertyId/settings/google"
              params={{ propertyId: property.id }}
              aria-label={`${notice} for ${property.name}`}
              className={cn(
                'inline-flex items-center gap-1 font-medium text-warn!',
                FOCUS_RING,
              )}
            >
              <Link2Off className="size-3" aria-hidden="true" />
              {notice}
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

type FigureProps = Readonly<{
  comparison: PropertyComparison | undefined
  fleet: DataState
}>

export function RatingValue({ comparison, fleet }: FigureProps) {
  if (!comparison)
    return fleet === 'loading' ? <Pending className="ml-auto w-10" /> : null
  if (comparison.avgRating === null) {
    return <span className="text-muted-foreground">No ratings</span>
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      <span className="tabular-nums">{comparison.avgRating.toFixed(1)}</span>
      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
      <span className="sr-only">stars</span>
    </span>
  )
}

export function ReviewsValue({ comparison, fleet }: FigureProps) {
  if (!comparison)
    return fleet === 'loading' ? <Pending className="ml-auto w-12" /> : null
  const count = comparison.reviewCount
  return (
    <span className="tabular-nums">
      {count.toLocaleString()}
      {/* The column header names the figure in the table; stacked, the words do. */}
      <span className="@4xl:sr-only"> {count === 1 ? 'review' : 'reviews'}</span>
    </span>
  )
}

export function AttentionValue({
  comparison,
  fleet,
  propertyId,
  propertyName,
}: FigureProps & Readonly<{ propertyId: string; propertyName: string }>) {
  if (!comparison) return fleet === 'loading' ? <Pending className="w-16" /> : null
  const { attention } = comparison
  const target = attentionTarget(attention)
  if (attention.total === 0 || target === null) {
    return <span className="text-muted-foreground">Nothing waiting</span>
  }
  const qualifiers = attentionQualifiers(attention)
  const label = [
    `${attention.total} need attention at ${propertyName}`,
    qualifiers.map((qualifier) => qualifier.text).join(', '),
  ]
    .filter(Boolean)
    .join(': ')
  const content = (
    <>
      <span className="font-semibold tabular-nums">{attention.total}</span>
      <span className="text-muted-foreground @4xl:hidden">need attention</span>
      {qualifiers.map((qualifier) => (
        <span
          key={qualifier.text}
          className={cn(
            "text-xs before:mr-1.5 before:text-muted-foreground before:content-['·']",
            qualifier.urgent ? 'font-medium text-negative' : 'text-muted-foreground',
          )}
        >
          {qualifier.text}
        </span>
      ))}
    </>
  )
  const className = cn(
    'inline-flex flex-wrap items-baseline gap-x-1.5 text-foreground!',
    FOCUS_RING,
  )
  if (target === 'goals') {
    return (
      <Link
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
        search={{ view: 'active' }}
        aria-label={label}
        className={className}
      >
        {content}
      </Link>
    )
  }
  return (
    <Link
      to="/properties/$propertyId/reviews"
      params={{ propertyId }}
      search={{ queue: target }}
      aria-label={label}
      className={className}
    >
      {content}
    </Link>
  )
}

function Segments({ done, total }: Readonly<{ done: number; total: number }>) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 w-2.5 rounded-[2px]',
            index < done ? 'bg-foreground/70' : 'bg-border',
          )}
        />
      ))}
    </span>
  )
}

export function SetupValue({
  setup,
  state,
  propertyId,
  propertyName,
}: Readonly<{
  setup: PropertySetupProgress | undefined
  state: DataState
  propertyId: string
  propertyName: string
}>) {
  if (!setup) return state === 'loading' ? <Pending className="w-24" /> : null
  const { completedCount, stepCount, nextStep } = setup
  if (nextStep === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Check className="size-3.5 text-positive" aria-hidden="true" />
        Done
      </span>
    )
  }
  const next =
    nextStep.status === 'needs_admin'
      ? 'Waiting on an account admin'
      : propertySetupStepLabel(nextStep)
  const progress = (
    <span className="inline-flex items-center gap-2">
      <Segments done={completedCount} total={stepCount} />
      <span className="tabular-nums">
        {completedCount} of {stepCount}
      </span>
    </span>
  )
  const target = nextStep.status === 'pending' ? propertySetupStepTarget(nextStep) : null
  if (target === null) {
    return (
      <span className="flex flex-col gap-0.5">
        {progress}
        <span className="text-xs text-muted-foreground">{next}</span>
      </span>
    )
  }
  return (
    <Link
      to={target}
      params={{ propertyId }}
      aria-label={`Setup ${completedCount} of ${stepCount} at ${propertyName}. Next: ${next}`}
      className={cn('flex flex-col gap-0.5 text-foreground!', FOCUS_RING)}
    >
      {progress}
      <span className="text-xs text-muted-foreground">Next: {next}</span>
    </Link>
  )
}
