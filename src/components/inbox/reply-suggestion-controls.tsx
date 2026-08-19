import { Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import type { ReplySuggestion, ReplyTone } from './use-reply-suggestion'

type ReplySuggestionControlsProps = Readonly<{
  tone: ReplyTone
  onToneChange: (tone: ReplyTone) => void
  suggestion: ReplySuggestion | null
  suggestionError: string | null
  isGenerating: boolean
  isSaving: boolean
  isAdopting: boolean
  isUseDialogOpen: boolean
  onUseDialogOpenChange: (open: boolean) => void
  onRequest: () => Promise<void>
  onOpenUseDialog: () => void
  onAdopt: () => Promise<void>
  onDiscard: () => void
}>

export function ReplySuggestionControls({
  tone,
  onToneChange,
  suggestion,
  suggestionError,
  isGenerating,
  isSaving,
  isAdopting,
  isUseDialogOpen,
  onUseDialogOpenChange,
  onRequest,
  onOpenUseDialog,
  onAdopt,
  onDiscard,
}: ReplySuggestionControlsProps) {
  return (
    <>
      <Select
        value={tone}
        onValueChange={(value) => onToneChange(value as ReplyTone)}
        disabled={isGenerating || isSaving || isAdopting}
      >
        <SelectTrigger
          size="sm"
          aria-label="Reply suggestion tone"
          className="min-h-11 w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="professional">Professional</SelectItem>
          <SelectItem value="friendly">Friendly</SelectItem>
          <SelectItem value="casual">Casual</SelectItem>
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isGenerating || isSaving || isAdopting}
        className="min-h-11"
        onClick={() => void onRequest()}
      >
        <Sparkles className="size-4" />
        {isGenerating ? 'Suggesting…' : 'Suggest reply'}
      </Button>

      {suggestion && (
        <section
          aria-label="AI reply suggestion"
          className="basis-full space-y-3 rounded-md border bg-muted/50 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">AI suggestion</Badge>
            <span className="text-xs text-muted-foreground">
              Review required. Nothing is saved or submitted automatically.
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{suggestion.text}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Suggestion text stays separate until you choose Use suggestion.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                disabled={isSaving || isAdopting}
                onClick={onOpenUseDialog}
              >
                Use suggestion
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11"
                disabled={isAdopting}
                onClick={onDiscard}
              >
                Discard
              </Button>
            </div>
          </div>
        </section>
      )}

      <AlertDialog
        open={isUseDialogOpen}
        onOpenChange={(open) => {
          if (!isAdopting) onUseDialogOpenChange(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this AI suggestion?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current composer text with the suggestion and saves it as
              an editable draft. It will not be submitted or published.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 text-sm">
            <div>
              <p className="mb-1 font-medium">Current draft</p>
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-muted-foreground">
                {suggestion?.baseText || 'No draft text'}
              </p>
            </div>
            <div>
              <p className="mb-1 font-medium">AI suggestion</p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border p-3">
                {suggestion?.text}
              </p>
            </div>
          </div>
          {suggestionError && (
            <p role="alert" className="text-sm text-destructive">
              {suggestionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={isAdopting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={isAdopting}
              onClick={(event) => {
                event.preventDefault()
                void onAdopt()
              }}
            >
              {isAdopting ? 'Using suggestion…' : 'Use suggestion'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {suggestionError && !isUseDialogOpen && (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {suggestionError}
        </p>
      )}
    </>
  )
}
