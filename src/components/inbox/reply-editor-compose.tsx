import { Sparkles } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from '#/components/ui/input-group'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import { ReplyComposerFooter } from './reply-composer-footer'
import { ReplyLanguageSelect } from './reply-language-select'
import { languageDisplayName, type ReplyLanguageTarget } from './reply-language-options'
import { ReplySuggestionControls } from './reply-suggestion-controls'
import { ReplyToolbarPortal } from './reply-toolbar-slot'
import { useReplyComposer } from './use-reply-composer'
import type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'

export type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'

export type ReplyComposeProps = Readonly<{
  initialText: string
  initialLanguageTag: string | null
  initialAiGenerated?: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  isSaving: boolean
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmit: () => Promise<unknown>
  onDelete?: () => Promise<unknown>
  onGenerateSuggestion?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

export function ReplyCompose(props: ReplyComposeProps) {
  const state = useReplyComposer({
    initialText: props.initialText,
    initialLanguageTag: props.initialLanguageTag,
    initialAiGenerated: props.initialAiGenerated ?? false,
    propertyLanguage: props.propertyDefaultReplyLanguage,
    reviewLanguage: props.reviewReplyLanguage,
    onSaveDraft: props.onSaveDraft,
    onSubmit: props.onSubmit,
    onGenerate: props.onGenerateSuggestion,
  })
  const busy = props.isSaving || state.ai.isGenerating

  return (
    <div className="space-y-4">
      <ReplyToolbarPortal>
        <ReplyLanguageSelect
          value={state.draft.languageTag}
          options={state.options}
          disabled={busy}
          onChange={state.updateLanguage}
        />
      </ReplyToolbarPortal>
      <InputGroup>
        {state.hasAiDraft && (
          <InputGroupAddon align="block-start">
            <InputGroupText className="text-primary">
              <Sparkles /> AI draft
            </InputGroupText>
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          aria-label="Public reply"
          className="text-base leading-relaxed"
          placeholder="Write a reply…"
          value={state.draft.text}
          rows={9}
          aria-invalid={state.overLimit}
          disabled={props.isSaving}
          onChange={(event) => state.updateText(event.target.value)}
          onBlur={state.flushOnBlur}
        />
        <InputGroupAddon align="block-end" className="flex-wrap gap-2 border-t">
          {props.onGenerateSuggestion && (
            <ReplySuggestionControls
              tone={state.ai.tone}
              disabled={busy || state.target === null}
              isGenerating={state.ai.isGenerating}
              hasAiDraft={state.hasAiDraft}
              canUndo={state.historyCount > 0}
              error={state.ai.error}
              onToneChange={state.ai.setTone}
              onRequest={state.ai.request}
              onUndo={state.undo}
            />
          )}
          <span
            className={`ml-auto text-xs ${state.overLimit ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {state.draft.text.length}/{MAX_REPLY_LENGTH}
          </span>
        </InputGroupAddon>
      </InputGroup>
      <ReplyComposerFooter
        status={state.autosave.status}
        error={state.autosave.error ?? state.submitError}
        languageName={languageDisplayName(state.draft.languageTag)}
        canSubmit={state.canSubmit}
        disabled={busy}
        isSubmitting={props.isSaving}
        onRetrySave={state.autosave.retry}
        onSubmit={state.submit}
        onDelete={props.onDelete}
      />
    </div>
  )
}
