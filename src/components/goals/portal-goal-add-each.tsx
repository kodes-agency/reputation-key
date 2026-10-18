// "A goal for each portal" (copy deck M-11, M-13): one row per live Portal, in
// the read's name order, with a tick box, its number between − and +, and what
// it needs saying: "New · ready Oct 29", "Has a goal" with a link to that goal
// (no tick reaches it), or "Not saved, try again". At an end − or + stays in the
// tab order (`aria-disabled`), as the set sheet's box does. Everything it says
// is the each view's (`portal-goal-add-each-view.ts`).
import { Minus, Plus, type LucideIcon } from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { IconButton } from '#/components/ui/icon-button'
import { InlineLink } from '#/components/ui/inline-link'
import { Label } from '#/components/ui/label'
import type { eachModel } from './portal-goal-add-each-view'

type Row = ReturnType<typeof eachModel>['rows'][number]

type Props = Readonly<{
  propertyId: string
  rows: readonly Row[]
  /** Set is on its way. */
  pending: boolean
  onTick: (portalId: string, ticked: boolean) => void
  onStep: (portalId: string, to: number) => void
}>

function Step({
  step,
  icon: Icon,
  waits,
  onStep,
}: Readonly<{
  step: Row['lower']
  icon: LucideIcon
  waits: boolean
  onStep: (to: number) => void
}>) {
  const { to } = step
  return (
    <IconButton
      label={step.label}
      variant="outline"
      size="icon"
      aria-disabled={waits || to === null}
      onClick={() => {
        if (!waits && to !== null) onStep(to)
      }}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  )
}

function EachRow({
  row,
  propertyId,
  pending,
  onTick,
  onStep,
}: Omit<Props, 'rows'> & Readonly<{ row: Row }>) {
  const id = `portal-goal-each-${row.portalId}`
  const step = (to: number) => onStep(row.portalId, to)
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          id={id}
          checked={row.ticked}
          disabled={row.disabled || pending}
          onCheckedChange={(checked) => onTick(row.portalId, checked === true)}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={id} className="font-medium">
            {row.name}
          </Label>
          {row.note === null ? null : (
            <span className="text-sm text-muted-foreground">{row.note}</span>
          )}
          {row.held === null ? null : (
            <InlineLink
              to="/properties/$propertyId/goals/$goalId"
              params={{ propertyId, goalId: row.held.programId }}
              className="self-start text-sm"
            >
              {row.held.name}
            </InlineLink>
          )}
        </div>
      </div>
      {row.disabled ? null : (
        <div className="flex items-center gap-2">
          <Step step={row.lower} icon={Minus} waits={pending} onStep={step} />
          <span className="min-w-20 text-center text-sm tabular-nums">
            {row.figure} <span className="text-muted-foreground">{row.unit}</span>
          </span>
          <Step step={row.raise} icon={Plus} waits={pending} onStep={step} />
        </div>
      )}
    </li>
  )
}

export function PortalGoalAddEach({ rows, ...props }: Props) {
  return (
    <ul aria-label="Portals" className="divide-y">
      {rows.map((row) => (
        <EachRow key={row.portalId} row={row} {...props} />
      ))}
    </ul>
  )
}
