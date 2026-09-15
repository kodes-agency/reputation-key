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
import {
  suggestedLanguageFor,
  type LanguageAnswer,
  type SetupPropertyFacts,
} from './setup-plan'
import {
  languageSuggestionSummary,
  mostSuggestedLanguage,
  replyLanguageLabel,
  SETUP_REPLY_LANGUAGE_OPTIONS,
} from './setup-summaries'

type Props = Readonly<{
  properties: readonly SetupPropertyFacts[]
  answer: LanguageAnswer | null
  onAnswerChange: (answer: LanguageAnswer | null) => void
  disabled: boolean
}>

type ChosenLanguage = Extract<LanguageAnswer, { kind: 'chosen' }>

function LanguageSelect({
  id,
  label,
  value,
  onValueChange,
  disabled,
}: Readonly<{
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  disabled: boolean
}>) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="min-h-11 w-full sm:min-h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SETUP_REPLY_LANGUAGE_OPTIONS.map((option) => (
          <SelectItem key={option.tag} value={option.tag}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Reply language (decision 2): prefilled from each property's country. */
export function SetupLanguageQuestion({
  properties,
  answer,
  onAnswerChange,
  disabled,
}: Props) {
  const many = properties.length > 1
  const only = properties[0]
  const chosen = answer?.kind === 'chosen' ? answer : null
  const choose = (patch: Partial<Omit<ChosenLanguage, 'kind'>>) =>
    onAnswerChange({
      kind: 'chosen',
      applyToAll: chosen?.applyToAll ?? true,
      language: chosen?.language ?? mostSuggestedLanguage(properties),
      overrides: chosen?.overrides ?? {},
      ...patch,
    })

  return (
    <QuestionnaireItem
      name="reply-language"
      onStatusChange={(status) => {
        if (status === 'skipped') onAnswerChange(null)
      }}
    >
      <QuestionnaireTitle>
        {many || !only
          ? 'Which language should replies use?'
          : `Which language should replies at ${only.propertyName} use?`}
      </QuestionnaireTitle>
      <QuestionnaireDescription>
        The default for public replies and AI drafts. A review can still be answered in
        the guest&apos;s language.
      </QuestionnaireDescription>
      <QuestionnaireChoices>
        <QuestionnaireChoice
          value="suggested"
          checked={answer?.kind === 'suggested'}
          disabled={disabled}
          onChange={() => onAnswerChange({ kind: 'suggested' })}
        >
          {many || !only
            ? "Use each property's suggested language"
            : `Use ${replyLanguageLabel(suggestedLanguageFor(only))}`}
          <QuestionnaireChoiceDescription>
            {languageSuggestionSummary(properties)}
          </QuestionnaireChoiceDescription>
        </QuestionnaireChoice>
        <QuestionnaireChoice
          value="chosen"
          checked={chosen !== null}
          disabled={disabled}
          onChange={() => choose({})}
        >
          Choose the language
          <QuestionnaireChoiceDescription>
            {many
              ? 'One language for all of them, or a different one per property.'
              : 'Pick another reply language.'}
          </QuestionnaireChoiceDescription>
        </QuestionnaireChoice>
      </QuestionnaireChoices>
      {chosen ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
          {!many || chosen.applyToAll ? (
            <LanguageSelect
              id="setup-reply-language"
              label={many ? 'Reply language for every property' : 'Reply language'}
              value={chosen.language}
              disabled={disabled}
              onValueChange={(language) => choose({ language })}
            />
          ) : null}
          {many ? (
            <ApplyToAllToggle
              id="setup-reply-language-all"
              checked={chosen.applyToAll}
              propertyCount={properties.length}
              disabled={disabled}
              onCheckedChange={(applyToAll) => choose({ applyToAll })}
            >
              {properties.map((property) => (
                <ApplyToAllOverride
                  key={property.propertyId}
                  propertyName={property.propertyName}
                >
                  <LanguageSelect
                    id={`setup-reply-language-${property.propertyId}`}
                    label={`Reply language for ${property.propertyName}`}
                    value={chosen.overrides[property.propertyId] ?? chosen.language}
                    disabled={disabled}
                    onValueChange={(language) =>
                      choose({
                        overrides: {
                          ...chosen.overrides,
                          [property.propertyId]: language,
                        },
                      })
                    }
                  />
                </ApplyToAllOverride>
              ))}
            </ApplyToAllToggle>
          ) : null}
        </div>
      ) : null}
      <QuestionnaireError />
    </QuestionnaireItem>
  )
}
