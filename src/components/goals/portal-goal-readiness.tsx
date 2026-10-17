// Each published Portal's three steps before the Monthly portal goal's number is
// ready (P-4, copy deck G-8 and G-10): Live, Code made, First scan, in Portal's
// name order. A step is a check once done and a ring until then, said in words
// for a screen reader. A code that has gone 14 days without a scan gets one
// neutral line and a way to its share tab, never a warning colour.
import { Check, Circle } from 'lucide-react'
import type { PortalReadinessRow } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { InlineLink } from '#/components/ui/inline-link'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { readinessWords } from './portal-goal-words'

type Props = Readonly<{
  propertyId: string
  portals: readonly PortalReadinessRow[]
}>

/** The name column, wide enough for "Restaurant" beside its steps from a 640 px screen. */
const ROW_COLUMNS = { gridTemplateColumns: 'minmax(0, 7rem) minmax(0, 1fr)' } as const

function Step({ label, done }: Readonly<{ label: string; done: boolean }>) {
  return (
    <span
      className={cn('inline-flex items-center gap-1', done && 'text-foreground')}
      data-done={done || undefined}
    >
      {done ? (
        <Check className={cn('size-3.5', TONE_INK.positive)} aria-hidden="true" />
      ) : (
        <Circle className="size-3.5" aria-hidden="true" />
      )}
      {label}
      <span className="sr-only">{done ? ' (done)' : ' (not yet)'}</span>
    </span>
  )
}

function ReadinessRow({
  propertyId,
  row,
}: Readonly<{ propertyId: string; row: PortalReadinessRow }>) {
  const { steps, hint } = readinessWords(row)
  return (
    <li className="flex flex-col gap-1 sm:grid sm:gap-x-3" style={ROW_COLUMNS}>
      <span className="min-w-0 font-medium">{row.name}</span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {steps.map((step) => (
          <Step key={step.label} {...step} />
        ))}
      </span>
      {hint === null ? null : (
        <p className="text-sm text-muted-foreground sm:col-start-2">
          {hint.text} {/* In a sentence: underlined, so it reads as a link in any ink. */}
          <InlineLink
            underline="always"
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId: row.portalId }}
            search={{ tab: 'share' }}
          >
            {hint.open}
          </InlineLink>
        </p>
      )}
    </li>
  )
}

export function PortalGoalReadiness({ propertyId, portals }: Props) {
  return (
    <ul aria-label="Portal readiness" className="flex flex-col gap-3 text-sm">
      {portals.map((row) => (
        <ReadinessRow key={row.portalId} propertyId={propertyId} row={row} />
      ))}
    </ul>
  )
}
