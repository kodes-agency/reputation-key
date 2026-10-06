// PROTOTYPE — the identity band at the head of a property's tiles: who this is, and the
// setup meter ("Setup 5 of 7", then the next step as one button) until it is done.
import { ArrowRight } from 'lucide-react'
import { personInitials } from '#/components/inbox/person-initials'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardTitle } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import type {
  PropertyFixture,
  SettingsPrototypeContext,
} from '../../settings-prototype-types'
import { BLink } from './b-links'
import { STEP_SENTENCE, nextStepOf } from './b-model'

const KIND = { hotel: 'Hotel', restaurant: 'Restaurant', salon: 'Salon' } as const

export function PropertyAvatar({
  name,
  className,
}: Readonly<{ name: string; className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-semibold text-link',
        className,
      )}
    >
      {personInitials(name) ?? '·'}
    </span>
  )
}

/** One segment per setup step, filled as they are done. */
function SetupBar({ done, total }: Readonly<{ done: number; total: number }>) {
  return (
    <div
      role="progressbar"
      aria-label="Setup"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="flex gap-1"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            index < done ? 'bg-primary' : 'bg-muted',
          )}
        />
      ))}
    </div>
  )
}

function SetupMeter({
  ctx,
  property,
}: Readonly<{ ctx: SettingsPrototypeContext; property: PropertyFixture }>) {
  const setup = ctx.rail.setup
  const step = nextStepOf(property, ctx)
  if (setup === null || setup.isComplete || step === null || setup.nextHref === null) {
    return null
  }
  const sentence = STEP_SENTENCE[step]
  return (
    <div className="flex w-full flex-col gap-3 md:w-80">
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Setup {setup.done} of {setup.total}
        </p>
        <SetupBar done={setup.done} total={setup.total} />
      </div>
      <Button asChild size="sm" className="justify-between">
        <BLink go={setup.nextHref}>
          <span className="truncate">
            Next: {sentence.charAt(0).toUpperCase() + sentence.slice(1)}
          </span>
          <ArrowRight aria-hidden />
        </BLink>
      </Button>
    </div>
  )
}

export function IdentityBand({
  ctx,
  property,
}: Readonly<{ ctx: SettingsPrototypeContext; property: PropertyFixture | null }>) {
  if (property === null) {
    return (
      <Card className="py-5">
        <CardContent className="flex items-center gap-4">
          <PropertyAvatar name={ctx.data.workspace.name} />
          <div className="min-w-0">
            <CardTitle as="h2">{ctx.data.workspace.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">No location yet</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="py-5">
      <CardContent className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 items-center gap-4">
          <PropertyAvatar name={property.name} />
          <div className="min-w-0 space-y-1">
            {ctx.shape.showPropertySwitcher ? (
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Selected property
              </p>
            ) : null}
            <CardTitle as="h2" className="truncate text-lg">
              {property.name}
            </CardTitle>
            <p className="truncate text-sm text-muted-foreground">
              {KIND[property.kind]} · {property.city}, {property.country}
            </p>
          </div>
        </div>
        <SetupMeter ctx={ctx} property={property} />
      </CardContent>
    </Card>
  )
}
