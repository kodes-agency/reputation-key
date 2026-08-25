// Fleet totals strip.
//
// Extracted from fleet-overview.tsx for the 200-line cap. Pure presentation:
// three org-wide numbers that are identical on every page of the fleet
// projection, which is why the paginated view reads them from the first page.
import type { Building2 } from 'lucide-react'

type StripStatProps = Readonly<{
  icon: typeof Building2
  label: string
  value: string
  hint?: string
  destructive?: boolean
}>

export function StripStat({
  icon: Icon,
  label,
  value,
  hint,
  destructive,
}: StripStatProps) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${destructive ? 'text-destructive' : ''}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
