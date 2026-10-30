import { Alert, AlertDescription } from '#/components/ui/alert'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type { ReplyLibraryDto } from '#/contexts/review/application/dto/reply-library.dto'
import { renderReply } from '#/shared/reply-library/render-reply'
import type { ResolvedReplyVoice } from '#/shared/reply-library/reply-voice'
import type { VoiceDraft, VoiceLanguage } from './reply-voice-model'

const PREVIEWS = [
  { key: 'P-GEN', label: '5 stars · with text', rating: 5, hasText: true, wording: 0 },
  { key: 'RO5', label: '5 stars · star-only', rating: 5, hasText: false, wording: 2 },
  { key: 'N-SPEED', label: '1 star · with text', rating: 1, hasText: true, wording: 0 },
] as const

function previewParts(
  text: string,
  body: string,
  includeContact: boolean,
): readonly Readonly<{ label: string; text: string }>[] {
  const sections = text.split('\n\n').filter(Boolean)
  if (sections.length < 3) return [{ label: 'Body', text: body }]
  const signature = sections.at(-1)?.split('\n').filter(Boolean) ?? []
  const middle = sections.slice(2, -1)
  const contact = includeContact ? middle.shift() : undefined
  const closing = middle.join('\n\n')
  return [
    { label: 'Greeting', text: sections[0] ?? '' },
    { label: 'Body', text: sections[1] ?? body },
    ...(contact ? [{ label: 'Contact', text: contact }] : []),
    ...(closing ? [{ label: 'Closing', text: closing }] : []),
    ...(signature[0] ? [{ label: 'Sign-off', text: signature[0] }] : []),
    ...(signature.slice(1).length
      ? [{ label: 'Signer', text: signature.slice(1).join('\n') }]
      : []),
  ].filter((part) => part.text.trim().length > 0)
}

export function ReplyVoicePreviews({
  canManage,
  draft,
  voice,
  library,
  propertyName,
  onLanguageChange,
}: Readonly<{
  canManage: boolean
  draft: VoiceDraft
  voice: ResolvedReplyVoice
  library: ReplyLibraryDto
  propertyName: string
  onLanguageChange: (language: VoiceLanguage) => void
}>) {
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      style={{ top: 'calc(var(--app-top-bar-height) + 1rem)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Live preview</p>
        {canManage ? (
          <SegmentedControl
            aria-label="Preview language"
            value={draft.language}
            options={[
              { value: 'en-Latn', label: 'English' },
              { value: 'es-Latn', label: 'Español' },
            ]}
            onValueChange={(value) => onLanguageChange(value as VoiceLanguage)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">English</p>
        )}
      </div>
      {PREVIEWS.map((example) => {
        const template = library.templates.find(
          (item) => item.ref === `builtin:${example.key}`,
        )
        const body =
          template?.wordings[draft.language]?.[example.wording]?.body ??
          template?.wordings[draft.language]?.[0]?.body
        if (!body) return null
        let text = body
        try {
          text = renderReply({
            body,
            voice,
            languageGroup: draft.language,
            rating: example.rating,
            hasText: example.hasText,
            reviewerDisplayName: 'Maria Lopez',
            propertyDisplayName: propertyName,
            choices: { closing: 0, signOff: 0, contactSentence: 0, emoji: 0 },
          }).text
        } catch {
          /* Keep the body visible while a wording list is empty. */
        }
        const parts = previewParts(
          text,
          body,
          voice.contact.value !== null && example.rating <= 3,
        )
        return (
          <div key={example.key} className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {example.label}
            </p>
            <DescriptionList stacked className="gap-2">
              {parts.map((part) => (
                <DescriptionItem key={part.label} term={part.label}>
                  <span className="whitespace-pre-wrap leading-relaxed">{part.text}</span>
                </DescriptionItem>
              ))}
            </DescriptionList>
          </div>
        )
      })}
      {!canManage ? (
        <Alert variant="info">
          <AlertDescription>Reply voice is read-only for your role.</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
