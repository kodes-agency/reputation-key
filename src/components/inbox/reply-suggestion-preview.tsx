import { ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  replyTemplateLoadedMessage,
  type PendingReplySuggestion,
} from './reply-suggestion-contract'

type Props = Readonly<{
  suggestion: PendingReplySuggestion
  propertyLanguage: string | null
  disabled: boolean
  isAdopting: boolean
  onAdopt: () => void
  onDismiss: () => void
}>

export const ReplySuggestionPreview = (props: Props) => {
  const languageTag = props.suggestion.draft.languageTag
  const templateLoadedMessage =
    props.suggestion.kind === 'local_fallback' && languageTag !== null
      ? replyTemplateLoadedMessage(
          {
            reason: props.suggestion.reason,
            languageSource: props.suggestion.languageSource,
            concreteLanguageTag: languageTag,
          },
          props.propertyLanguage,
        )
      : null

  return (
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
      {props.suggestion.kind === 'local_fallback' &&
        props.suggestion.reason === 'provider_or_output_unavailable' && (
          // Deliberately does not blame the provider. This sentence used to read
          // "The AI service was unavailable", but a local fallback is offered for
          // any reason a personalized draft could not be produced - including our
          // own output checks refusing the model's answer, which accounted for 11
          // of 26 real draft requests on the beta property. Naming the provider
          // sent the operator to retry a service that was working.
          <p className="mt-2 text-xs text-muted-foreground">
            A personalized draft was not available, so this general wording was prepared
            locally. Try again for a personalized draft, or review and edit this one
            before publishing.
          </p>
        )}
      {templateLoadedMessage !== null && (
        <p className="mt-2 text-xs text-muted-foreground">{templateLoadedMessage}</p>
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
}
