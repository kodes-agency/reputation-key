import { Link } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import type {
  PropertySetup,
  PropertySetupStep,
} from '#/contexts/reporting/application/public-api'
import { cn } from '#/lib/utils'
import {
  completedPropertySetupStepCount,
  openPropertySetupSteps,
  propertySetupStepLabel,
} from './property-setup-steps'

type Props = Readonly<{
  propertyId: string
  setup: PropertySetup | undefined
  className?: string
}>

function StepLink({
  propertyId,
  step,
}: Readonly<{ propertyId: string; step: PropertySetupStep }>) {
  const label = propertySetupStepLabel(step)
  const chip =
    'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors'
  if (step.status === 'waiting') {
    return (
      <span className={cn(chip, 'border-dashed text-muted-foreground')}>
        <Loader2
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {label}
      </span>
    )
  }
  if (step.status === 'needs_admin' || step.section === null) {
    return <span className={cn(chip, 'text-muted-foreground')}>{label}</span>
  }
  const className = cn(
    chip,
    'bg-background font-medium hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  )
  const content = (
    <>
      {label}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </>
  )
  if (step.section === 'portals') {
    return (
      <Link
        to="/properties/$propertyId/portals"
        params={{ propertyId }}
        className={className}
      >
        {content}
      </Link>
    )
  }
  return (
    <Link
      to={`/properties/$propertyId/settings/${step.section}`}
      params={{ propertyId }}
      className={className}
    >
      {content}
    </Link>
  )
}

/**
 * What is left to set this property up, as one row of links. It disappears
 * once nothing is left for the viewer to do; a deferred AI decision counts as
 * decided, so it never nags.
 */
export function PropertySetupStrip({ propertyId, setup, className }: Props) {
  if (!setup) return null
  const open = openPropertySetupSteps(setup)
  if (open.length === 0) return null
  const done = completedPropertySetupStepCount(setup)

  return (
    <section
      aria-labelledby={`property-setup-${propertyId}`}
      className={cn(
        'rounded-lg border border-primary/20 bg-primary/[0.03] p-4 dark:bg-primary/[0.06]',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`property-setup-${propertyId}`} className="text-sm font-semibold">
          Finish setting up this property
        </h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          {done} of {setup.steps.length} done
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {open.map((step) => (
          <li key={step.key}>
            <StepLink propertyId={propertyId} step={step} />
          </li>
        ))}
      </ul>
    </section>
  )
}
