import type { ReactNode } from 'react'
import type { MetricAvailabilityState } from '#/contexts/reporting/application/public-api'
import { AvailabilityLine } from '#/components/features/dashboard/availability-line'

export type StatCardAvailability = Readonly<{
  state: MetricAvailabilityState
  dataThrough: Date | null
  reason: string | null
  locale?: string
  timeZone?: string
}>

type Props = Readonly<{
  label: string
  value: ReactNode
  hint?: ReactNode
  availability?: StatCardAvailability
}>

export function StatCard({ label, value, hint, availability }: Props) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint === undefined ? null : (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      )}
      {availability === undefined ? null : (
        <div className="mt-1">
          <AvailabilityLine {...availability} />
        </div>
      )}
    </div>
  )
}
