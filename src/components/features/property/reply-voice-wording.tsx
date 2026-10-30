import type { Dispatch, SetStateAction } from 'react'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Textarea } from '#/components/ui/textarea'
import { WORDING_LISTS, type VoiceDraft, type VoiceLanguage } from './reply-voice-model'

export function ReplyVoiceWording({
  draft,
  defaults,
  pending,
  setDraft,
}: Readonly<{
  draft: VoiceDraft
  defaults: VoiceDraft
  pending: boolean
  setDraft: Dispatch<SetStateAction<VoiceDraft>>
}>) {
  const language = draft.language
  const setLanguage = (value: VoiceLanguage) =>
    setDraft((current) => ({ ...current, language: value }))
  const setList = (key: (typeof WORDING_LISTS)[number]['key'], value: string) =>
    setDraft((current) => ({
      ...current,
      lists: {
        ...current.lists,
        [language]: { ...current.lists[language], [key]: value },
      },
    }))

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline">
          Wording
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 flex flex-col gap-4">
        <SegmentedControl
          aria-label="Wording language"
          value={language}
          options={[
            { value: 'en-Latn', label: 'English' },
            { value: 'es-Latn', label: 'Español' },
          ]}
          onValueChange={(value) => setLanguage(value as VoiceLanguage)}
          touch
        />
        {WORDING_LISTS.map((item) => (
          <FormFieldFrame
            key={item.key}
            id={`reply-voice-${language}-${item.key}`}
            label={item.label}
            description="One option per line."
            invalid={false}
          >
            <Textarea
              id={`reply-voice-${language}-${item.key}`}
              rows={3}
              value={draft.lists[language][item.key]}
              onChange={(event) => setList(item.key, event.target.value)}
              disabled={pending}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setList(item.key, defaults.lists[language][item.key])}
            >
              Reset to default
            </Button>
          </FormFieldFrame>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
