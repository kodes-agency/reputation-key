// One row of "Build your own" (round 2, R2-6): what it picks, a line on what it
// takes, up to three options with one marked Recommended, and "Own", which
// shows the row's own control under the options. The row is a radio group
// named by its label; the options are radio cards. An option's detail and chips
// run the card's whole width under its radio and title, and a chip wraps its
// words rather than leave the card, so a phone's two columns hold them.
import { useId, type ReactNode, type Ref } from 'react'
import { Badge } from '#/components/ui/badge'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { StatusBadge } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'
import {
  OWN,
  pickFromRadio,
  rowChecked,
  type RowOption,
} from './rating-goal-build-own-view'
import { OPTION, OPTION_LABEL, QUIET } from './rating-goal-option'
import type { RowPick } from './rating-goal-plan-view'

type Props = Readonly<{
  label: string
  /** A line under the label on what the row takes. */
  hint?: string
  options: readonly RowOption[]
  pick: RowPick
  onPick: (pick: RowPick) => void
  /** The row's own control, shown while "Own" is checked. */
  own: ReactNode
  groupRef?: Ref<HTMLDivElement>
}>

/** A chip that wraps its words inside a narrow card instead of running past it. */
const WRAPPING_CHIP = 'max-w-full whitespace-normal'

/** An option's radio is named by its title ("4.5★") and described by the rest. */
function OptionCard({ option, id }: Readonly<{ option: RowOption; id: string }>) {
  const hasDetail = option.detail !== null || option.chip !== null || option.recommended
  return (
    <div className={cn(OPTION, 'flex-wrap gap-y-1')}>
      <RadioGroupItem
        value={String(option.value)}
        id={id}
        aria-describedby={hasDetail ? `${id}-detail` : undefined}
        className="mt-0.5"
      />
      <Label htmlFor={id} className={cn(OPTION_LABEL, 'min-w-0 flex-1')}>
        <span className="text-base font-semibold tabular-nums">{option.title}</span>
      </Label>
      {hasDetail ? (
        <p
          id={`${id}-detail`}
          className="flex min-w-0 basis-full flex-col items-start gap-1"
        >
          {option.detail === null ? null : (
            <span className="text-xs text-muted-foreground">{option.detail}</span>
          )}{' '}
          {option.chip === null ? null : (
            <StatusBadge {...option.chip} className={WRAPPING_CHIP} />
          )}{' '}
          {option.recommended ? (
            <Badge variant="outline" className={WRAPPING_CHIP}>
              Recommended
            </Badge>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

export function RatingGoalPlanRow({
  label,
  hint,
  options,
  pick,
  onPick,
  own,
  groupRef,
}: Props) {
  const id = useId()
  const checked = rowChecked(pick, options)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p id={`${id}-label`} className="text-sm font-medium">
          {label}
        </p>
        {hint === undefined ? null : (
          <p id={`${id}-hint`} className={QUIET}>
            {hint}
          </p>
        )}
      </div>
      <RadioGroup
        ref={groupRef}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        value={checked}
        onValueChange={(value) => onPick(pickFromRadio(value, pick, options))}
        className="grid-cols-2 gap-2 md:grid-cols-4"
      >
        {options.map((option) => (
          <OptionCard key={option.value} option={option} id={`${id}-${option.value}`} />
        ))}
        <div className={OPTION}>
          <RadioGroupItem value={OWN} id={`${id}-own`} className="mt-0.5" />
          <Label htmlFor={`${id}-own`} className={OPTION_LABEL}>
            Own
          </Label>
        </div>
      </RadioGroup>
      {checked === OWN ? own : null}
    </div>
  )
}
