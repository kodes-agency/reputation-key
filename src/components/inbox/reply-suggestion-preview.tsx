import { ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { languageDisplayName } from './reply-language-options'
import { INBOX_SCROLL_REGION } from './use-inbox-keyboard-shortcuts'
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

/**
 * The proposed reply's own growth cap.
 *
 * This preview mounts inside region 4 — the pinned composer
 * (`reply-composer.tsx`) — and prints the WHOLE proposed reply, up to
 * Google's 4096-byte reply limit (`reply-comment.ts`), at most 4096 Latin
 * characters, about seventy wrapped lines. The
 * region's own cap reaches textareas only (`[&_textarea]:max-h-80`) and this is
 * a `<p>`, so without a cap here the proposal is what grows.
 *
 * What that costs is now VISIBILITY, not reachability: the region bounds itself
 * against the column and scrolls (`REGION_CLASS`), so an uncapped proposal
 * pushes `Use draft` and the footer's `Submit for approval` below the fold of
 * the region's own scroller — one scroll away rather than clipped by an
 * `overflow-hidden` column with no way back. That is the same distinction the
 * region draws for the draft box, and the same bargain: the text scrolls inside
 * itself and everything below it stays exactly where it was.
 *
 * `svh` is the last viewport unit left in the region and is no longer
 * load-bearing now that the region is bounded — see the PR report. `tabIndex`
 * because a scrollable region has to be reachable by keyboard (WCAG 2.1.1);
 * `overscroll-contain` so reaching its end does not then scroll the region,
 * and the thread, behind it.
 */
const PROPOSAL_CLASS =
  'mt-2 max-h-[28svh] overflow-y-auto overscroll-contain whitespace-pre-wrap text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export const ReplySuggestionPreview = (props: Props) => {
  const languageTag = props.suggestion.draft.languageTag
  const languageName = languageDisplayName(languageTag)
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
        {/* The heading names the language the proposal is IN — the verified
            tag it will be adopted with — as a quiet second part. Without it
            the first visible language name was the result tag after `Use
            draft`: a fluent proposal in the manager's own language reads as
            right, and a Turkish guest could be sent Bulgarian (PR 4 review).
            It matters most for a regenerate, which can ask in a language the
            composer has not selected yet. Its own span keeps the title's exact
            text. */}
        <span>
          {props.suggestion.kind === 'personalized'
            ? 'Personalized AI suggestion'
            : 'Local safe starting point'}
        </span>
        {languageName !== null && (
          <span className="font-normal text-muted-foreground">· {languageName}</span>
        )}
      </div>
      <p className={PROPOSAL_CLASS} tabIndex={0} {...{ [INBOX_SCROLL_REGION]: '' }}>
        {props.suggestion.draft.text}
      </p>
      {templateLoadedMessage !== null && (
        <p className="mt-2 text-xs text-muted-foreground">{templateLoadedMessage}</p>
      )}
      <div className="mt-3 flex gap-2">
        {/* `outline`, never the default. `Submit for approval` is region 4's
            ONLY primary (row 7, and `reply-composer.tsx`'s own doc comment
            claims it), and this preview mounts a few pixels above it — so the
            default variant put two purple buttons in one pinned region, asking
            for the same click, one of which merely fills the box in. Plan
            finding 4; the drafting controls one file over were fixed for it. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          // Row 20: 36 px on mobile over `size="sm"`'s 32, matching the mode
          // segment (`composer-mode-row.tsx`), the note submit and
          // `Submit for approval` below. v1's row 15 had made both of these 44
          // (`max-md:h-11`), taller than the dock's own primary. Measured in
          // Chromium against Storybook dev after the sweep
          // (`inbox-replycomposer--suggestion-awaiting-adoption`, preview open):
          // `Use draft` and `Dismiss` 36 px tall at 390 and 320.
          className="max-md:h-9"
          disabled={props.disabled}
          onClick={props.onAdopt}
        >
          {props.isAdopting ? 'Saving…' : 'Use draft'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="max-md:h-9"
          disabled={props.disabled}
          onClick={props.onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </section>
  )
}
