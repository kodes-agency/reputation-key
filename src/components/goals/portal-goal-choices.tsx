// The set sheet's three suggested numbers (copy deck U-S2, from S-4): "your
// usual", "a bit more" (the recommended one, P-3, with the shared recommendation
// tag) and "stretch", as radio rows in the panel the sheet draws around them. The
// row that holds the box's number is checked and wears the weight; the others are
// muted. An own number checks none. Choosing one puts it in the box.
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { cn } from '#/lib/utils'
import { GoalRecommendedTag } from './goal-setup-parts'
import type { PortalGoalChoice } from './portal-goal-sheet-words'
import { RECOMMENDED_TAG } from './portal-goal-words'

type Choices = readonly PortalGoalChoice[]

type Props = Readonly<{
  choices: Choices
  chosen: number | null
  /** Prefixes each radio's id. */
  idPrefix: string
  onChoose: (value: number) => void
  disabled?: boolean
}>

export function PortalGoalChoices({
  choices,
  chosen,
  idPrefix,
  onChoose,
  disabled,
}: Props) {
  return (
    <RadioGroup
      aria-label="Suggested numbers"
      value={chosen === null ? '' : String(chosen)}
      onValueChange={(next) => {
        const choice = choices.find(({ value }) => String(value) === next)
        if (choice) onChoose(choice.value)
      }}
      disabled={disabled}
      // Room for the line quoted under the last row.
      className="mb-1"
    >
      {choices.map(({ value, figure, words, recommended }, index) => {
        const id = `${idPrefix}-${value}`
        return (
          // The rows are told apart by a line between them, as the panel's own parts are.
          <div
            key={value}
            className={cn('flex items-center gap-3', index > 0 && 'border-t pt-3')}
          >
            <RadioGroupItem value={String(value)} id={id} />
            <Label
              htmlFor={id}
              className={cn(
                'flex flex-1 items-center justify-between gap-2',
                value === chosen ? 'font-semibold' : 'font-normal text-muted-foreground',
              )}
            >
              <span className="flex gap-3">
                <span className="tabular-nums">{figure}</span> <span>{words}</span>
              </span>
              {/* Said apart from the number: "40 a bit more Recommended". */}
              {recommended ? (
                <>
                  {' '}
                  <GoalRecommendedTag>{RECOMMENDED_TAG}</GoalRecommendedTag>
                </>
              ) : null}
            </Label>
          </div>
        )
      })}
    </RadioGroup>
  )
}
