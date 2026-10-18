// The set sheet's three suggested numbers (copy deck S-4): "your usual", "a bit
// more" (the recommended one, P-3, with its neutral badge) and "stretch", as
// radio cards. The card that holds the box's number is checked; an own number
// checks none. Choosing one puts it in the box.
import type { ReactNode } from 'react'
import { Badge } from '#/components/ui/badge'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import type { PortalGoalSheetModel } from './portal-goal-sheet-view'

type Choices = NonNullable<PortalGoalSheetModel['choices']>

type Props = Readonly<{
  choices: Choices
  chosen: number | null
  /** Prefixes each radio's id. */
  idPrefix: string
  onChoose: (value: number) => void
  disabled?: boolean
}>

function ChoiceCard({
  id,
  value,
  children,
}: Readonly<{ id: string; value: number; children: ReactNode }>) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <RadioGroupItem value={String(value)} id={id} />
      <Label
        htmlFor={id}
        className="flex flex-1 items-center justify-between gap-2 font-normal"
      >
        {children}
      </Label>
    </div>
  )
}

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
      className="gap-2"
    >
      {choices.map(({ value, label, recommended }) => (
        <ChoiceCard key={value} id={`${idPrefix}-${value}`} value={value}>
          <span className="text-sm tabular-nums">{label}</span>
          {/* Said apart from the number: "40 · a bit more Recommended". */}
          {recommended ? (
            <>
              {' '}
              <Badge variant="neutral">Recommended</Badge>
            </>
          ) : null}
        </ChoiceCard>
      ))}
    </RadioGroup>
  )
}
