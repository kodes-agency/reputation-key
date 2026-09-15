import type { CurrentMerchantAiCapability } from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import {
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireTitle,
} from '#/components/ui/questionnaire'
import { Switch } from '#/components/ui/switch'
import { ApplyToAllOverride, ApplyToAllToggle } from './apply-to-all-toggle'
import { toggleAiCapability, type AiAnswer, type SetupPropertyFacts } from './setup-plan'

type Props = Readonly<{
  properties: readonly SetupPropertyFacts[]
  notice: MerchantAiNoticeDto
  answer: AiAnswer | null
  onAnswerChange: (answer: AiAnswer | null) => void
  disabled: boolean
}>

type EnableAnswer = Extract<AiAnswer, { kind: 'enable' }>

/**
 * The AI decision (decisions 2, 3, 8): turn AI on with one capability set, or
 * "not now", which counts as decided. Consent itself is given on the review
 * screen, against the notice, before anything is saved.
 */
export function SetupAiQuestion({
  properties,
  notice,
  answer,
  onAnswerChange,
  disabled,
}: Props) {
  const many = properties.length > 1
  const order: readonly CurrentMerchantAiCapability[] = notice.payload.capabilities.map(
    (capability) => capability.id,
  )
  const enabled = answer?.kind === 'enable' ? answer : null
  const enable = (patch: Partial<Omit<EnableAnswer, 'kind'>>) =>
    onAnswerChange({
      kind: 'enable',
      capabilities: enabled?.capabilities ?? order,
      applyToAll: enabled?.applyToAll ?? true,
      excluded: enabled?.excluded ?? [],
      ...patch,
    })

  return (
    <QuestionnaireItem
      name="ai-decision"
      invalid={enabled !== null && enabled.capabilities.length === 0}
      onStatusChange={(status) => {
        if (status === 'skipped') onAnswerChange(null)
      }}
    >
      <QuestionnaireTitle>Turn on AI features?</QuestionnaireTitle>
      <QuestionnaireDescription>
        RepKey can analyse reviews, draft replies and show property trends. Nothing is
        sent to the AI provider until you agree to the data use notice on the next screen.
      </QuestionnaireDescription>
      <QuestionnaireChoices>
        <QuestionnaireChoice
          value="enable"
          checked={enabled !== null}
          disabled={disabled}
          onChange={() => enable({})}
        >
          Turn on AI features
          <QuestionnaireChoiceDescription>
            Choose the features below. You can change them per property later.
          </QuestionnaireChoiceDescription>
        </QuestionnaireChoice>
        <QuestionnaireChoice
          value="defer"
          checked={answer?.kind === 'defer'}
          disabled={disabled}
          onChange={() => onAnswerChange({ kind: 'defer' })}
        >
          Not now
          <QuestionnaireChoiceDescription>
            Nothing is analysed. Turn AI on any time in each property&apos;s AI settings.
          </QuestionnaireChoiceDescription>
        </QuestionnaireChoice>
      </QuestionnaireChoices>
      {enabled ? (
        <div className="flex flex-col gap-4 rounded-md bg-muted/40 p-3">
          <FieldGroup className="gap-3">
            {notice.payload.capabilities.map((capability) => (
              <Field key={capability.id} orientation="horizontal" className="items-start">
                <Checkbox
                  id={`setup-ai-${capability.id}`}
                  className="mt-0.5"
                  checked={enabled.capabilities.includes(capability.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    enable({
                      capabilities: toggleAiCapability(
                        enabled.capabilities,
                        capability.id,
                        checked === true,
                        order,
                      ),
                    })
                  }
                />
                <FieldLabel htmlFor={`setup-ai-${capability.id}`}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{capability.title}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {capability.description}
                    </span>
                  </span>
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
          {many ? (
            <ApplyToAllToggle
              id="setup-ai-all"
              checked={enabled.applyToAll}
              propertyCount={properties.length}
              disabled={disabled}
              onCheckedChange={(applyToAll) => enable({ applyToAll })}
            >
              {properties.map((property) => {
                const included = !enabled.excluded.includes(property.propertyId)
                return (
                  <ApplyToAllOverride
                    key={property.propertyId}
                    propertyName={property.propertyName}
                  >
                    <div className="flex items-center gap-3 sm:justify-end">
                      <span aria-hidden="true" className="text-sm text-muted-foreground">
                        {included ? 'AI on' : 'Not now'}
                      </span>
                      <Switch
                        aria-label={`AI features for ${property.propertyName}`}
                        checked={included}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          enable({
                            excluded: checked
                              ? enabled.excluded.filter(
                                  (id) => id !== property.propertyId,
                                )
                              : [...enabled.excluded, property.propertyId],
                          })
                        }
                      />
                    </div>
                  </ApplyToAllOverride>
                )
              })}
            </ApplyToAllToggle>
          ) : null}
        </div>
      ) : null}
      <QuestionnaireError>
        {enabled !== null && enabled.capabilities.length === 0
          ? 'Choose at least one AI feature, or answer Not now.'
          : undefined}
      </QuestionnaireError>
    </QuestionnaireItem>
  )
}
