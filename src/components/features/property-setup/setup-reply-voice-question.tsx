import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireTitle,
} from '#/components/ui/questionnaire'
import { renderReply } from '#/shared/reply-library/render-reply'
import type { ResolvedReplyVoice } from '#/shared/reply-library/reply-voice'
import type { ReplyVoiceAnswer, SetupPropertyFacts } from './setup-plan'

function withAnswer(
  voice: ResolvedReplyVoice,
  answer: ReplyVoiceAnswer,
): ResolvedReplyVoice {
  const field = <T,>(value: T) => ({ value, source: 'property' as const })
  return {
    ...voice,
    useFirstName: field(answer.useFirstName),
    signerName: field(answer.signerName.trim() || null),
    signerTitle: field(answer.signerTitle.trim() || null),
    contact: field(answer.contact.trim() || null),
    emojiMode: field(answer.emojiMode),
  }
}

export function SetupReplyVoiceQuestion({
  properties,
  answer,
  disabled,
  onAnswerChange,
}: Readonly<{
  properties: readonly SetupPropertyFacts[]
  answer: ReplyVoiceAnswer | null
  disabled: boolean
  onAnswerChange: (answer: ReplyVoiceAnswer | null) => void
}>) {
  const property = properties[0]
  if (!property?.replyVoice) return null
  const current: ReplyVoiceAnswer = answer ?? {
    useFirstName: property.replyVoice.useFirstName.value,
    signerName: property.replyVoice.signerName.value ?? '',
    signerTitle: property.replyVoice.signerTitle.value ?? '',
    contact: property.replyVoice.contact.value ?? '',
    emojiMode: property.replyVoice.emojiMode.value,
  }
  const change = <K extends keyof ReplyVoiceAnswer>(key: K, value: ReplyVoiceAnswer[K]) =>
    onAnswerChange({ ...current, [key]: value })
  let preview = 'Thank you for sharing your experience with us.'
  try {
    preview = renderReply({
      body: preview,
      voice: withAnswer(property.replyVoice, current),
      languageGroup: 'en-Latn',
      rating: 5,
      hasText: true,
      reviewerDisplayName: 'Maria Lopez',
      propertyDisplayName: property.propertyName,
      choices: { closing: 0, signOff: 0, contactSentence: 0, emoji: 0 },
    }).text
  } catch {
    /* The saved voice always provides a valid fallback. */
  }
  return (
    <QuestionnaireItem
      name="reply-voice"
      onStatusChange={(status) => {
        if (status === 'skipped') onAnswerChange(null)
      }}
    >
      <QuestionnaireTitle>Reply voice</QuestionnaireTitle>
      <QuestionnaireDescription>
        Set the few details RepKey needs to frame replies consistently.
      </QuestionnaireDescription>
      <QuestionnaireChoices>
        <QuestionnaireChoice
          value="configured"
          checked={answer !== null}
          disabled={disabled}
          onChange={() => onAnswerChange(current)}
        >
          Use these reply voice settings
          <QuestionnaireChoiceDescription>
            Review the details below, then continue. You can change them later.
          </QuestionnaireChoiceDescription>
        </QuestionnaireChoice>
      </QuestionnaireChoices>
      <div className="grid gap-5">
        <div className="flex flex-col gap-4">
          <SettingSwitchRow
            id="setup-reply-first-name"
            label="Greet reviewers by first name"
            commit="deferred"
            checked={current.useFirstName}
            onCheckedChange={(value) => change('useFirstName', value)}
            disabled={disabled}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormFieldFrame
              id="setup-reply-signer-name"
              label="Who signs 1–3-star replies"
              optional
              invalid={false}
            >
              <Input
                id="setup-reply-signer-name"
                value={current.signerName}
                placeholder="Name"
                onChange={(event) => change('signerName', event.target.value)}
                disabled={disabled}
              />
            </FormFieldFrame>
            <FormFieldFrame
              id="setup-reply-signer-title"
              label="Signer title"
              optional
              invalid={false}
            >
              <Input
                id="setup-reply-signer-title"
                value={current.signerTitle}
                placeholder="Title"
                onChange={(event) => change('signerTitle', event.target.value)}
                disabled={disabled}
              />
            </FormFieldFrame>
          </div>
          <FormFieldFrame
            id="setup-reply-contact"
            label="Contact for unhappy reviewers"
            optional
            invalid={false}
          >
            <Input
              id="setup-reply-contact"
              value={current.contact}
              placeholder="Email or phone"
              onChange={(event) => change('contact', event.target.value)}
              disabled={disabled}
            />
          </FormFieldFrame>
          <FormFieldFrame id="setup-reply-emoji" label="Emoji" invalid={false}>
            <SegmentedControl
              aria-label="Emoji"
              value={current.emojiMode}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'positive', label: 'In positive replies' },
              ]}
              onValueChange={(value) =>
                change('emojiMode', value as ReplyVoiceAnswer['emojiMode'])
              }
              disabled={disabled}
              touch
            />
          </FormFieldFrame>
        </div>
        <div>
          <p className="mb-2 font-medium">Live preview</p>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{preview}</p>
          </div>
        </div>
      </div>
    </QuestionnaireItem>
  )
}
