import { FormFieldFrame, describedByOf } from '#/components/forms/form-field-frame'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { VoiceDraft } from './reply-voice-model'
import { emojiSetTooLarge, GREETINGS } from './reply-voice-model'

type Change = <K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) => void

const VOICE_LIST_LABEL: Readonly<Record<keyof VoiceDraft['lists']['en-Latn'], string>> = {
  positiveText: '4–5 stars with text',
  positiveRatingOnly: '4–5 stars without text',
  threeStar: '3 stars',
  negative: '1–2 stars',
  contactSentences: 'Contact sentences',
  positiveSignOff: 'Positive sign-off words',
  negativeSignOff: 'Negative sign-off words',
}

export function ReadOnlyVoice({
  draft,
  propertyName,
}: Readonly<{ draft: VoiceDraft; propertyName: string }>) {
  return (
    <DescriptionList stacked>
      <DescriptionItem term="Reviewer greeting">
        {draft.useFirstName ? 'First name' : 'No name'}
      </DescriptionItem>
      <DescriptionItem term="Greeting for 4–5 stars">
        {GREETINGS.find(({ value }) => value === draft.positiveGreeting)?.label}
      </DescriptionItem>
      <DescriptionItem term="Greeting for 1–3 stars">
        {GREETINGS.find(({ value }) => value === draft.negativeGreeting)?.label}
      </DescriptionItem>
      <DescriptionItem term="Business name">
        {draft.businessName || propertyName}
      </DescriptionItem>
      <DescriptionItem term="1–3-star signer">
        {[draft.signerName, draft.signerTitle].filter(Boolean).join(', ') ||
          `${draft.businessName || propertyName} Management`}
      </DescriptionItem>
      <DescriptionItem term="Contact">{draft.contact || 'Not set'}</DescriptionItem>
      <DescriptionItem term="Emoji">
        {draft.emojiMode === 'positive'
          ? draft.emojiSet || 'On for positive replies'
          : 'Off'}
      </DescriptionItem>
      <DescriptionItem term="Visit word">{draft.visitWordKey}</DescriptionItem>
      <DescriptionItem term="Health privacy mode">
        {draft.privacyMode ? 'On' : 'Off'}
      </DescriptionItem>
      {(['en-Latn', 'es-Latn'] as const).flatMap((language) => {
        const label = language === 'en-Latn' ? 'English' : 'Spanish'
        return Object.entries(draft.lists[language]).map(([key, value]) => (
          <DescriptionItem
            key={`${language}-${key}`}
            term={`${label} · ${VOICE_LIST_LABEL[key as keyof typeof VOICE_LIST_LABEL]}`}
          >
            {value.split('\n').filter(Boolean).join(' · ') || 'Not set'}
          </DescriptionItem>
        ))
      })}
    </DescriptionList>
  )
}

export function ReplyVoiceFields({
  draft,
  saved,
  propertyName,
  pending,
  change,
}: Readonly<{
  draft: VoiceDraft
  saved: VoiceDraft
  propertyName: string
  pending: boolean
  change: Change
}>) {
  return (
    <>
      <SettingSwitchRow
        id="reply-voice-first-name"
        label="Greet reviewers by first name"
        description="Taken from their Google name. When the name doesn't look like a first name, the reply starts with “Hello,”."
        commit="deferred"
        checked={draft.useFirstName}
        unsaved={draft.useFirstName !== saved.useFirstName}
        onCheckedChange={(value) => change('useFirstName', value)}
        disabled={pending}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormFieldFrame
          id="reply-voice-positive-greeting"
          label="Greeting for 4–5 stars"
          invalid={false}
        >
          <SegmentedControl
            aria-label="Greeting for 4–5 stars"
            value={draft.positiveGreeting}
            options={GREETINGS}
            onValueChange={(value) =>
              change('positiveGreeting', value as VoiceDraft['positiveGreeting'])
            }
            disabled={pending}
            touch
          />
        </FormFieldFrame>
        <FormFieldFrame
          id="reply-voice-negative-greeting"
          label="Greeting for 1–3 stars"
          invalid={false}
        >
          <SegmentedControl
            aria-label="Greeting for 1–3 stars"
            value={draft.negativeGreeting}
            options={GREETINGS}
            onValueChange={(value) =>
              change('negativeGreeting', value as VoiceDraft['negativeGreeting'])
            }
            disabled={pending}
            touch
          />
        </FormFieldFrame>
      </div>
      <FormFieldFrame
        id="reply-voice-business-name"
        label="Business name in signatures"
        invalid={false}
      >
        <Input
          id="reply-voice-business-name"
          value={draft.businessName}
          placeholder={propertyName}
          onChange={(event) => change('businessName', event.target.value)}
          disabled={pending}
        />
      </FormFieldFrame>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormFieldFrame
          id="reply-voice-signer-name"
          label="Who signs 1–3-star replies"
          optional
          description={`Leave empty to sign as “${draft.businessName || propertyName} Management”.`}
          invalid={false}
        >
          <Input
            id="reply-voice-signer-name"
            value={draft.signerName}
            placeholder="Name"
            aria-describedby={describedByOf('reply-voice-signer-name', true)}
            onChange={(event) => change('signerName', event.target.value)}
            disabled={pending}
          />
        </FormFieldFrame>
        <FormFieldFrame
          id="reply-voice-signer-title"
          label="Signer title"
          optional
          description={`Positive replies are signed “${draft.businessName || propertyName} Team”.`}
          invalid={false}
        >
          <Input
            id="reply-voice-signer-title"
            value={draft.signerTitle}
            placeholder="Title"
            aria-describedby={describedByOf('reply-voice-signer-title', true)}
            onChange={(event) => change('signerTitle', event.target.value)}
            disabled={pending}
          />
        </FormFieldFrame>
      </div>
      <FormFieldFrame
        id="reply-voice-contact"
        label="Contact for unhappy reviewers"
        optional
        description="Complaints answered with a way to reach you tend to do better."
        invalid={false}
      >
        <Input
          id="reply-voice-contact"
          value={draft.contact}
          placeholder="Email or phone"
          aria-describedby={describedByOf('reply-voice-contact', true)}
          onChange={(event) => change('contact', event.target.value)}
          disabled={pending}
        />
      </FormFieldFrame>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormFieldFrame id="reply-voice-emoji-mode" label="Emoji" invalid={false}>
          <SegmentedControl
            aria-label="Emoji"
            value={draft.emojiMode}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'positive', label: 'In positive replies' },
            ]}
            onValueChange={(value) =>
              change('emojiMode', value as VoiceDraft['emojiMode'])
            }
            disabled={pending}
            touch
          />
        </FormFieldFrame>
        {draft.emojiMode === 'positive' ? (
          <FormFieldFrame
            id="reply-voice-emojis"
            label="Property emoji"
            description="Add up to five, separated by spaces."
            invalid={emojiSetTooLarge(draft.emojiSet)}
            errors={
              emojiSetTooLarge(draft.emojiSet)
                ? [{ message: 'Use no more than five emoji.' }]
                : undefined
            }
          >
            <Input
              id="reply-voice-emojis"
              value={draft.emojiSet}
              maxLength={32}
              aria-describedby={describedByOf('reply-voice-emojis', true)}
              onChange={(event) => change('emojiSet', event.target.value)}
              disabled={pending}
            />
          </FormFieldFrame>
        ) : null}
      </div>
      <FormFieldFrame id="reply-voice-visit-word" label="Visit word" invalid={false}>
        <Select
          value={draft.visitWordKey}
          onValueChange={(value) => change('visitWordKey', value)}
          disabled={pending}
        >
          <SelectTrigger id="reply-voice-visit-word">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['visit', 'stay', 'appointment', 'meal', 'trip', 'session'].map((word) => (
              <SelectItem key={word} value={word}>
                {word}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormFieldFrame>
      <SettingSwitchRow
        id="reply-voice-privacy"
        label="Health business privacy mode"
        description="No names and no mention of appointments or treatments, for clinics, dental and med spas."
        commit="deferred"
        checked={draft.privacyMode}
        unsaved={draft.privacyMode !== saved.privacyMode}
        onCheckedChange={(value) => change('privacyMode', value)}
        disabled={pending}
      />
    </>
  )
}
