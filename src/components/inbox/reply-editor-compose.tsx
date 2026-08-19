// Inbox detail — reply composer for empty and draft states

import { Textarea } from '#/components/ui/textarea'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import { ReplySuggestionControls } from './reply-suggestion-controls'
import {
  useReplySuggestion,
  type ReplySuggestionResult,
  type ReplyTone,
} from './use-reply-suggestion'

export type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'

export type ReplyComposeProps = Readonly<{
  initialText: string
  isSaving: boolean
  onSaveDraft: (text: string, provenanceToken?: string) => Promise<unknown>
  onSubmit: (text: string, provenanceToken?: string) => Promise<unknown>
  onDelete?: () => Promise<unknown>
  onGenerateSuggestion?: (tone: ReplyTone) => Promise<ReplySuggestionResult>
}>

export function ReplyCompose({
  initialText,
  isSaving,
  onSaveDraft,
  onSubmit,
  onDelete,
  onGenerateSuggestion,
}: ReplyComposeProps) {
  const suggestionState = useReplySuggestion({
    initialText,
    onSaveDraft,
    onGenerateSuggestion,
  })
  const {
    text,
    suggestion,
    isAdopting,
    suggestionError,
    isUseDialogOpen,
    clearSuggestion,
    updateText,
  } = suggestionState
  const charCount = text.length
  const isOverLimit = charCount > MAX_REPLY_LENGTH
  const canAct = text.trim().length > 0 && !isOverLimit && !isSaving && !isAdopting

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-medium">Reply</h2>
        {onDelete && <Badge variant="secondary">Draft</Badge>}
        {onGenerateSuggestion && (
          <ReplySuggestionControls
            tone={suggestionState.tone}
            onToneChange={suggestionState.setTone}
            suggestion={suggestion}
            suggestionError={suggestionError}
            isGenerating={suggestionState.isGenerating}
            isSaving={isSaving}
            isAdopting={isAdopting}
            isUseDialogOpen={isUseDialogOpen}
            onUseDialogOpenChange={suggestionState.setIsUseDialogOpen}
            onRequest={suggestionState.requestSuggestion}
            onOpenUseDialog={suggestionState.openUseDialog}
            onAdopt={suggestionState.adoptSuggestion}
            onDiscard={clearSuggestion}
          />
        )}
      </div>

      <Textarea
        placeholder="Write a reply..."
        value={text}
        onChange={(event) => updateText(event.target.value)}
        rows={4}
        disabled={isSaving || isAdopting}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-xs ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {charCount}/{MAX_REPLY_LENGTH}
        </span>
        <div className="flex flex-wrap gap-2">
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isSaving || isAdopting}
              className="min-h-11"
              onClick={async () => {
                await onDelete()
                clearSuggestion()
              }}
            >
              Delete
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={!canAct}
            onClick={async () => {
              await onSaveDraft(text)
              clearSuggestion()
            }}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            disabled={!canAct}
            onClick={async () => {
              await onSubmit(text)
              clearSuggestion()
            }}
          >
            Submit for Approval
          </Button>
        </div>
      </div>
    </div>
  )
}
