import {
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireTitle,
} from '#/components/ui/questionnaire'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { ApplyToAllOverride, ApplyToAllToggle } from './apply-to-all-toggle'
import type { SetupMember } from './property-setup-contract'
import type { ManagerAnswer, SetupPropertyFacts } from './setup-plan'
import { eligibleManagerChoices, memberLabel } from './setup-summaries'

type Props = Readonly<{
  properties: readonly SetupPropertyFacts[]
  members: ReadonlyMap<string, SetupMember>
  answer: ManagerAnswer | null
  onAnswerChange: (answer: ManagerAnswer | null) => void
  disabled: boolean
}>

const SAME_AS_ABOVE = '__same__'

/** Responsible manager (decision 2): the importing admin by default. */
export function SetupManagerQuestion({
  properties,
  members,
  answer,
  onAnswerChange,
  disabled,
}: Props) {
  const many = properties.length > 1
  const only = properties[0]
  const choices = eligibleManagerChoices(properties, members)
  const current: ManagerAnswer = answer ?? {
    applyToAll: true,
    managerIds: [],
    overrides: {},
  }
  const toggle = (userId: string, checked: boolean) => {
    const managerIds = checked
      ? [...current.managerIds.filter((id) => id !== userId), userId]
      : current.managerIds.filter((id) => id !== userId)
    onAnswerChange(
      managerIds.length === 0 && current.applyToAll ? null : { ...current, managerIds },
    )
  }

  return (
    <QuestionnaireItem
      name="responsible-manager"
      multiple
      onStatusChange={(status) => {
        if (status === 'skipped') onAnswerChange(null)
      }}
    >
      <QuestionnaireTitle>
        {many || !only
          ? 'Who is responsible for these properties?'
          : `Who is responsible for ${only.propertyName}?`}
      </QuestionnaireTitle>
      <QuestionnaireDescription>
        Responsible managers receive property-wide operational updates. Responsibility
        does not change anyone&apos;s access.
      </QuestionnaireDescription>
      <QuestionnaireChoices>
        {choices.map((choice) => (
          <QuestionnaireChoice
            key={choice.userId}
            value={choice.userId}
            checked={current.managerIds.includes(choice.userId)}
            disabled={disabled}
            onChange={(event) => toggle(choice.userId, event.target.checked)}
          >
            {choice.label}
            {many && choice.eligibleCount < properties.length ? (
              <QuestionnaireChoiceDescription>
                Can take {choice.eligibleCount} of {properties.length} properties
              </QuestionnaireChoiceDescription>
            ) : null}
          </QuestionnaireChoice>
        ))}
      </QuestionnaireChoices>
      {many && current.managerIds.length > 0 ? (
        <ApplyToAllToggle
          id="setup-responsible-manager-all"
          checked={current.applyToAll}
          propertyCount={properties.length}
          disabled={disabled}
          onCheckedChange={(applyToAll) => onAnswerChange({ ...current, applyToAll })}
        >
          {properties.map((property) => {
            const override = current.overrides[property.propertyId]
            return (
              <ApplyToAllOverride
                key={property.propertyId}
                propertyName={property.propertyName}
              >
                <Select
                  value={override?.[0] ?? SAME_AS_ABOVE}
                  disabled={disabled}
                  onValueChange={(value) => {
                    const others = Object.entries(current.overrides).filter(
                      ([propertyId]) => propertyId !== property.propertyId,
                    )
                    onAnswerChange({
                      ...current,
                      overrides: Object.fromEntries(
                        value === SAME_AS_ABOVE
                          ? others
                          : [...others, [property.propertyId, [value]]],
                      ),
                    })
                  }}
                >
                  <SelectTrigger
                    aria-label={`Responsible manager for ${property.propertyName}`}
                    className="min-h-11 w-full sm:min-h-9"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SAME_AS_ABOVE}>Same as above</SelectItem>
                    {property.eligibleManagerIds
                      .filter((userId) => members.has(userId))
                      .map((userId) => (
                        <SelectItem key={userId} value={userId}>
                          {memberLabel(members, userId)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </ApplyToAllOverride>
            )
          })}
        </ApplyToAllToggle>
      ) : null}
      <QuestionnaireError />
    </QuestionnaireItem>
  )
}
