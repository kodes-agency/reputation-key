import { useMemo, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { FormActions } from '#/components/forms/form-actions'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type {
  ReplyLibraryDto,
  SaveReplyVoiceInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import { ReadOnlyVoice, ReplyVoiceFields } from './reply-voice-fields'
import {
  initialVoiceDraft,
  emojiSetTooLarge,
  resolveDraftVoice,
  voiceDraftChanged,
  voiceSaveInput,
  type VoiceDraft,
} from './reply-voice-model'
import { ReplyVoicePreviews } from './reply-voice-previews'
import { ReplyVoiceWording } from './reply-voice-wording'

type SaveVoiceAction = Action<{ data: SaveReplyVoiceInput }, ReplyLibraryDto>

export function ReplyVoiceCard({
  propertyId,
  propertyName,
  propertyCount,
  library,
  action,
}: Readonly<{
  propertyId: string
  propertyName: string
  propertyCount: number
  library: ReplyLibraryDto
  action: SaveVoiceAction
}>) {
  const canManage = library.canManage === true
  const [draft, setDraft] = useState(() => initialVoiceDraft(library.voice))
  const [saved, setSaved] = useState(() => initialVoiceDraft(library.voice))
  const voice = useMemo(
    () => resolveDraftVoice(library.voice, draft),
    [draft, library.voice],
  )
  const defaults = useMemo(
    () => initialVoiceDraft(resolveVoice(BUILTIN_REPLY_VOICE, null, null)),
    [],
  )
  const dirty = voiceDraftChanged(draft, saved)
  const emojiInvalid = draft.emojiMode === 'positive' && emojiSetTooLarge(draft.emojiSet)
  const scope = propertyCount > 1 ? 'property' : 'account'
  const change = <K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    const result = await action({
      data: voiceSaveInput(propertyId, scope, draft, saved, library),
    })
    if (result) setSaved(draft)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Reply voice</CardTitle>
        <CardDescription>
          Set how every template and AI draft greets, closes, and signs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          {propertyCount > 1 ? (
            <p className="text-sm text-muted-foreground">
              These settings apply to {propertyName}.
            </p>
          ) : null}
          {!canManage ? (
            <ReadOnlyVoice draft={draft} propertyName={propertyName} />
          ) : (
            <>
              <ReplyVoiceFields
                draft={draft}
                saved={saved}
                propertyName={propertyName}
                pending={action.isPending}
                change={change}
              />
              <ReplyVoiceWording
                draft={draft}
                defaults={defaults}
                pending={action.isPending}
                setDraft={setDraft}
              />
            </>
          )}
        </div>
        <ReplyVoicePreviews
          canManage={canManage}
          draft={draft}
          voice={voice}
          library={library}
          propertyName={propertyName}
          onLanguageChange={(language) => change('language', language)}
        />
      </CardContent>
      {canManage ? (
        <CardFooter>
          <FormActions
            dirty={dirty}
            onReset={() => setDraft(saved)}
            error={action.error}
            pending={action.isPending}
          >
            <Button
              type="button"
              disabled={emojiInvalid}
              pending={action.isPending}
              pendingLabel="Saving…"
              onClick={() => void save().catch(() => undefined)}
            >
              Save reply voice
            </Button>
          </FormActions>
        </CardFooter>
      ) : null}
    </Card>
  )
}
