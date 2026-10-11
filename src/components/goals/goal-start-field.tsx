// New goal — when it starts: the current month of the Property's calendar, or
// the next one. The options carry the month itself (`YYYY-MM`), not "this" or
// "next", so the choice cannot drift while the form is open. Under them the
// page may say what the month already holds, because a goal that starts this
// month counts from its first day.
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'

export type GoalStartFieldOption = Readonly<{
  /** `YYYY-MM` on the Property's calendar. */
  monthKey: string
  /** "This month — counts everything since Oct 1". */
  label: string
}>

type Props = Readonly<{
  options: readonly GoalStartFieldOption[]
  /** The month key chosen. */
  value: string
  onValueChange: (monthKey: string) => void
  /** "So far this month: 412", once read; null while there is nothing to say. */
  soFar: string | null
  /** The question, where it is not about one goal: "When do these goals start?" */
  legend?: string
}>

const LEGEND_ID = 'goal-start-legend'

export function GoalStartField({
  options,
  value,
  onValueChange,
  soFar,
  legend = 'When does this goal start?',
}: Props) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend id={LEGEND_ID} className="mb-2 text-sm leading-snug font-medium">
        {legend}
      </legend>
      <RadioGroup value={value} onValueChange={onValueChange} aria-labelledby={LEGEND_ID}>
        {options.map((option) => {
          const id = `goal-start-${option.monthKey}`
          return (
            <div key={option.monthKey} className="flex items-start gap-2">
              <RadioGroupItem value={option.monthKey} id={id} />
              <Label htmlFor={id} className="leading-snug">
                {option.label}
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      {soFar === null ? null : <p className="text-sm text-muted-foreground">{soFar}</p>}
    </fieldset>
  )
}
