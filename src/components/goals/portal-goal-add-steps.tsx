// The add sheet's choosing steps (copy deck M-2…M-9): what to add, as radio
// cards, with a closed one and the fact that closes it ("Your portals had 6 in
// the last 4 weeks.", or the average's "Has a goal" and a link to that goal);
// then which Portal or group, where one that has a goal is closed with "Has a
// goal" and a link to that goal. Everything they say is
// the add view's (`portal-goal-add-view.ts`); they draw it and hand each pick up.
import { useId, type ReactNode } from 'react'
import { InlineLink } from '#/components/ui/inline-link'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { PORTAL_SPOT_NOT_PERSON_LINE } from './portal-goal-copy'
import type { PortalGoalAddHeld } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import type {
  chooseModel,
  PortalGoalAddKind,
  PortalGoalAddRow,
} from './portal-goal-add-view'

/** A radio card: the `RoleChoice` pattern the set sheet's suggestions use. */
function RadioCard({
  id,
  value,
  disabled,
  children,
  after,
}: Readonly<{
  id: string
  value: string
  disabled: boolean
  children: ReactNode
  /** Under the card's label, outside it: a link is not part of the choice. */
  after?: ReactNode
}>) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <div className="flex items-start gap-3">
        <RadioGroupItem value={value} id={id} disabled={disabled} className="mt-0.5" />
        <Label
          htmlFor={id}
          className="flex flex-1 flex-col items-start gap-1 font-normal"
        >
          {children}
        </Label>
      </div>
      {after}
    </div>
  )
}

/** M-9: the goal that holds a closed card, linked under it. */
function HeldLink({
  propertyId,
  held,
}: Readonly<{ propertyId: string; held: PortalGoalAddHeld | null }>) {
  if (held === null) return null
  return (
    // Lined up with the label, past the radio and its gap.
    <div className="pl-7">
      <InlineLink
        to="/properties/$propertyId/goals/$goalId"
        params={{ propertyId, goalId: held.programId }}
        className="text-sm"
      >
        {held.name}
      </InlineLink>
    </div>
  )
}

type ChooseProps = Readonly<{
  propertyId: string
  model: ReturnType<typeof chooseModel>
  picked: PortalGoalAddKind | null
  onPick: (kind: PortalGoalAddKind) => void
  disabled: boolean
}>

/** M-2…M-7: what to add. */
export function PortalGoalAddChoose({
  propertyId,
  model,
  picked,
  onPick,
  disabled,
}: ChooseProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        aria-label="What to add"
        value={picked ?? ''}
        onValueChange={(next) => {
          const choice = model.choices.find(({ kind }) => kind === next)
          if (choice && !choice.disabled) onPick(choice.kind)
        }}
        disabled={disabled}
        className="gap-2"
      >
        {model.choices.map((choice) => (
          <RadioCard
            key={choice.kind}
            id={`${id}-${choice.kind}`}
            value={choice.kind}
            disabled={choice.disabled}
            after={<HeldLink propertyId={propertyId} held={choice.held} />}
          >
            <span className="text-sm font-medium">{choice.title}</span>
            <span className="text-sm text-muted-foreground">{choice.description}</span>
            {choice.fact === null ? null : (
              <span className="text-sm text-muted-foreground">{choice.fact}</span>
            )}
          </RadioCard>
        ))}
      </RadioGroup>
      <p className="text-sm text-muted-foreground">{PORTAL_SPOT_NOT_PERSON_LINE}</p>
    </div>
  )
}

type WhichProps = Readonly<{
  propertyId: string
  /** The step's question, for the group's name. */
  label: string
  rows: readonly PortalGoalAddRow[]
  picked: string | null
  onPick: (key: string) => void
  disabled: boolean
}>

/** M-9: which Portal, or which group; one that has a goal links to it. */
export function PortalGoalAddWhich({
  propertyId,
  label,
  rows,
  picked,
  onPick,
  disabled,
}: WhichProps) {
  const id = useId()
  return (
    <RadioGroup
      aria-label={label}
      value={picked ?? ''}
      onValueChange={(next) => {
        const row = rows.find(({ key }) => key === next)
        if (row && !row.disabled) onPick(row.key)
      }}
      disabled={disabled}
      className="gap-2"
    >
      {rows.map((row, index) => (
        <RadioCard
          key={row.key}
          id={`${id}-${index}`}
          value={row.key}
          disabled={row.disabled}
          after={<HeldLink propertyId={propertyId} held={row.held} />}
        >
          <span className="text-sm font-medium">{row.name}</span>
          {row.note === null ? null : (
            <span className="text-sm text-muted-foreground">{row.note}</span>
          )}
        </RadioCard>
      ))}
    </RadioGroup>
  )
}
