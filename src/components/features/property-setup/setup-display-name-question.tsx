import {
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle,
} from '#/components/ui/questionnaire'
import { ApplyToAllOverride } from './apply-to-all-toggle'
import {
  suggestedDisplayNameFor,
  type DisplayNameAnswer,
  type SetupPropertyFacts,
} from './setup-plan'

type Props = Readonly<{
  properties: readonly SetupPropertyFacts[]
  answer: DisplayNameAnswer | null
  onAnswerChange: (answer: DisplayNameAnswer | null) => void
  disabled: boolean
}>

/** The longest public display name Portal branding accepts. */
const DISPLAY_NAME_MAX_LENGTH = 120

/**
 * Public display name: the business name AI reply drafts use and the guest
 * portal shows. Every field opens on the name the property already has, so
 * the question is answered as it appears and typing only changes it.
 */
export function SetupDisplayNameQuestion({
  properties,
  answer,
  onAnswerChange,
  disabled,
}: Props) {
  const names = answer?.names ?? {}
  const field = (property: SetupPropertyFacts, label: string) => (
    <QuestionnaireInput
      aria-label={label}
      value={names[property.propertyId] ?? suggestedDisplayNameFor(property)}
      placeholder={suggestedDisplayNameFor(property)}
      maxLength={DISPLAY_NAME_MAX_LENGTH}
      disabled={disabled}
      onChange={(event) =>
        onAnswerChange({
          names: { ...names, [property.propertyId]: event.currentTarget.value },
        })
      }
    />
  )
  const [only] = properties

  return (
    <QuestionnaireItem
      name="public-display-name"
      onStatusChange={(status) => {
        if (status === 'skipped') onAnswerChange(null)
      }}
    >
      <QuestionnaireTitle>
        {properties.length > 1
          ? 'Which names should guests see?'
          : 'Which name should guests see?'}
      </QuestionnaireTitle>
      <QuestionnaireDescription>
        AI reply drafts use it for the business, and the guest portal shows it. It starts
        as the property name; change it if guests know the business by another name.
      </QuestionnaireDescription>
      {properties.length > 1 ? (
        <ul
          aria-label="Public display name per property"
          className="flex flex-col divide-y rounded-md border"
        >
          {properties.map((property) => (
            <ApplyToAllOverride
              key={property.propertyId}
              propertyName={property.propertyName}
            >
              {field(property, `Public display name for ${property.propertyName}`)}
            </ApplyToAllOverride>
          ))}
        </ul>
      ) : only ? (
        field(only, 'Public display name')
      ) : null}
      <QuestionnaireError>Enter a name, or skip this question.</QuestionnaireError>
    </QuestionnaireItem>
  )
}
