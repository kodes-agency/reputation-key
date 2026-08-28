import { ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PendingReplySuggestion } from './reply-suggestion-contract'

type Props = Readonly<{
  suggestion: PendingReplySuggestion
  disabled: boolean
  isAdopting: boolean
  onAdopt: () => void
  onDismiss: () => void
}>

export const ReplySuggestionPreview = (props: Props) => (
  <section aria-label="Draft suggestion" className="rounded-lg border bg-muted/30 p-3">
    <div className="flex items-center gap-2 text-sm font-medium">
      {props.suggestion.kind === 'personalized' ? (
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
      ) : (
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
      )}
      {props.suggestion.kind === 'personalized'
        ? 'Personalized AI suggestion'
        : 'Local safe starting point'}
    </div>
    <p className="mt-2 whitespace-pre-wrap text-sm">{props.suggestion.draft.text}</p>
    {props.suggestion.kind === 'local_fallback' && (
      <p className="mt-2 text-xs text-muted-foreground">
        The AI service was unavailable, so this general wording was prepared locally.
        Review and edit it before publishing.
      </p>
    )}
    <div className="mt-3 flex gap-2">
      <Button type="button" size="sm" disabled={props.disabled} onClick={props.onAdopt}>
        {props.isAdopting ? 'Saving…' : 'Use draft'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={props.disabled}
        onClick={props.onDismiss}
      >
        Dismiss
      </Button>
    </div>
  </section>
)
