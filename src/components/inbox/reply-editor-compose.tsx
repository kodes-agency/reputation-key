import { useEffect, useRef } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import { cn } from '#/lib/utils'
import {
  DOCK_FOOT_ROW_CLASS,
  DOCK_TEXT_ROW_CLASS,
  DOCK_TEXTAREA_CLASS,
} from './composer-dock-rows'
import { useComposerSaveStateReport } from './composer-mode-row'
import { ReplyComposerFooter } from './reply-composer-footer'
import { ReplyDraftOriginTag } from './reply-draft-origin-tag'
import type {
  ReplyLanguageTarget,
  ReviewLanguageReadiness,
} from './reply-language-options'
import { ReplySuggestionControls } from './reply-suggestion-controls'
import { ReplySuggestionPreview } from './reply-suggestion-preview'
import { useReplyComposer } from './use-reply-composer'
import type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'
import type { LoadedReplyTemplateDraft } from './reply-suggestion-contract'

export type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'

export type ReplyComposeProps = Readonly<{
  propertyId: string
  initialText: string
  initialLanguageTag: string | null
  initialAiGenerated?: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  /** Whether the original review contains enough text for governed detection. */
  reviewLanguageReadiness: ReviewLanguageReadiness
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
    templateOnly?: boolean,
  ) => Promise<ReplySuggestionResult>
  onListTemplates?: (target: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  onLoadTemplate?: (
    templateId: string,
    target: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
}>

const PRIMARY_EXPLANATIONS: Readonly<Record<ReviewLanguageReadiness, string>> = {
  no_review_text: 'A template is recommended because this review has no text.',
  insufficient_language_evidence:
    'A template is recommended because this review is too short to identify its language.',
  detectable: 'AI drafting is recommended because this review has enough specific text.',
}

function templateUnavailableReason(
  hasTarget: boolean,
  canLoadTemplates: boolean,
): string | null {
  if (!hasTarget) {
    return 'Choose a supported reply language before loading a template.'
  }
  return canLoadTemplates ? null : 'The property template library is unavailable.'
}

function aiUnavailableReason(
  hasTarget: boolean,
  canGenerate: boolean,
  readiness: ReviewLanguageReadiness,
): string | null {
  if (!hasTarget) {
    return 'Choose a supported reply language before drafting with AI.'
  }
  if (!canGenerate) {
    return 'AI drafting is unavailable.'
  }
  if (readiness === 'no_review_text') {
    return 'AI drafting needs review text.'
  }
  if (readiness === 'insufficient_language_evidence') {
    return 'AI drafting needs enough review text to verify its language.'
  }
  return null
}

// The dock's TEXT and FOOT rows, and the borderless textarea, live in
// `composer-dock-rows.ts`: every writing surface in the dock — this one, the
// note form and the published-reply editor — draws the same two rows, so the
// geometry that keeps the primary pinned is spelled once.

export function ReplyCompose(props: ReplyComposeProps) {
  const state = useReplyComposer({
    initialText: props.initialText,
    initialLanguageTag: props.initialLanguageTag,
    initialAiGenerated: props.initialAiGenerated ?? false,
    propertyLanguage: props.propertyDefaultReplyLanguage,
    reviewLanguage: props.reviewReplyLanguage,
    reviewLanguageReadiness: props.reviewLanguageReadiness,
    onSaveDraft: props.onSaveDraft,
    onSubmit: props.onSubmit,
    onGenerate: props.onGenerateSuggestion,
    onListTemplates: props.onListTemplates,
    onLoadTemplate: props.onLoadTemplate,
  })
  // Row 16: the autosave status is produced HERE and printed in the dock's
  // head, which this component does not render. The hook reports it up through
  // the dock's context and retracts it on unmount (`composer-mode-row.tsx`
  // explains why a context and not a callback threaded through the pane).
  useComposerSaveStateReport(state.autosave.status)
  // `Use draft` unmounts the preview it sits in, taking the focused button
  // with it, and focus fell to `<body>`: a keyboard or screen-reader user's
  // next Tab started from the top of the document (PR 4 review, measured in
  // the `ai-draft-tag` story). Once an adoption this dock asked for has
  // SETTLED — `isAdopting` false and the suggestion gone — the caret goes into
  // the text it produced. Not while adopting: the textarea is disabled then,
  // and a disabled element takes no focus. A failed adoption keeps its
  // preview, and `Use draft` with it, so nothing moves.
  const textarea = useRef<HTMLTextAreaElement>(null)
  const returnCaretAfterAdopt = useRef(false)
  const { isAdopting, suggestion } = state.ai
  useEffect(() => {
    if (!returnCaretAfterAdopt.current || isAdopting) return
    returnCaretAfterAdopt.current = false
    if (suggestion === null) textarea.current?.focus()
  }, [isAdopting, suggestion])
  const busy =
    props.isSaving ||
    state.ai.isGenerating ||
    state.ai.isAdopting ||
    state.templates.isLoading
  const usesTemplatePath = props.reviewLanguageReadiness !== 'detectable'
  const templateBlockedReason = templateUnavailableReason(
    state.target !== null,
    Boolean(props.onListTemplates && props.onLoadTemplate),
  )
  const aiBlockedReason = aiUnavailableReason(
    state.target !== null,
    Boolean(props.onGenerateSuggestion),
    props.reviewLanguageReadiness,
  )
  const primaryExplanation = PRIMARY_EXPLANATIONS[props.reviewLanguageReadiness]
  const { draftOrigin, languageChoices } = state

  return (
    // The slot's column, transparent to the region's bound: `min-h-0 grow
    // basis-auto` is the chain `reply-composer.tsx` hangs the 60 % cap on, and
    // the text row below is where it finally lands.
    //
    // WHERE THE LANGUAGE WENT (row 17). There is no language row above the box
    // any more, and no alert. The picker only ever chose between two targets —
    // `ReplyLanguageTarget` is exactly `property_default | review_language`
    // (`reply-language-options.ts`) — and the server reads the choice only for
    // the two assist actions: the template library is filtered by the target's
    // `templateGroup` (`reply-template-operations.ts:137`) and a loaded
    // template stamps `replyLanguageTag` (`:304`); an AI draft is stamped the
    // same way (`ai-suggested-draft-store.ts:360`); a hand-typed draft only
    // records it (`reply-operations.ts:325`) and nothing reads it at publish.
    // So the choice rides inside `Draft with AI ▾` (`Write in`) and `Template
    // ▾` (`Templates in`), and the result tag at the top of the text names the
    // language the assist action actually used.
    //
    // The client does read it for a hand-typed reply — automatic detection
    // stops autosave and Submit. The menus keep the selection available, the
    // preview names the language it was drafted in, and Submit is described by
    // why it is refused while the language is unresolved (`submitBlockedReason`).
    <div className="flex min-h-0 grow basis-auto flex-col">
      <div className={DOCK_TEXT_ROW_CLASS}>
        {state.ai.suggestion && (
          // The preview's own box stays: it is a proposal ABOUT the text, not
          // the text, and the dashed/solid vocabulary of the dock does not
          // apply to it. Inset to the text's 12 px so the two line up.
          <div className="px-3 pt-2.5">
            <ReplySuggestionPreview
              suggestion={state.ai.suggestion}
              propertyLanguage={props.propertyDefaultReplyLanguage}
              disabled={busy}
              isAdopting={state.ai.isAdopting}
              onAdopt={() => {
                returnCaretAfterAdopt.current = true
                void state.ai.adopt()
              }}
              onDismiss={state.ai.dismiss}
            />
          </div>
        )}
        {draftOrigin && (
          <ReplyDraftOriginTag
            origin={draftOrigin}
            languageChoices={languageChoices}
            canRegenerate={
              Boolean(props.onGenerateSuggestion) &&
              props.reviewLanguageReadiness === 'detectable'
            }
            disabled={busy}
            // Asks in the other language WITHOUT selecting it: the draft keeps
            // its text, tag and saved language until the preview is adopted
            // (`regenerateScope`, `reply-composer-transitions.ts`).
            onRegenerate={(languageTag) => void state.regenerateIn(languageTag)}
          />
        )}
        {state.templates.loadedMessage && (
          // Announced, not printed: the tag above already SHOWS which
          // template loaded, in which language. The status stays so a
          // screen reader still hears the load complete.
          <p role="status" className="sr-only">
            {state.templates.loadedMessage}
          </p>
        )}
        <Textarea
          ref={textarea}
          aria-label="Public reply"
          className={cn(DOCK_TEXTAREA_CLASS, draftOrigin && 'pt-1')}
          placeholder="Write a reply…"
          value={state.draft.text}
          rows={9}
          aria-invalid={state.overLimit}
          disabled={props.isSaving || state.ai.isAdopting || state.templates.isLoading}
          onChange={(event) => state.updateText(event.target.value)}
          onBlur={state.flushOnBlur}
        />
      </div>
      <div className={DOCK_FOOT_ROW_CLASS}>
        {/* `flex-auto`, not the controls' own `flex-1`: `flex-1` is a ZERO
            basis, so the foot never broke its line — the tools were squeezed
            instead, and at 390 px the two split buttons stacked on top of
            each other beside the count (measured: `Template ▾` 44 px below
            `Draft with AI ▾`, the foot 93 px tall). An auto basis makes the
            tools' natural width the line-break test, so the count and
            `Submit for approval` wrap under the tools as a unit. `min-w-0`
            still lets a long error sentence in the tools wrap on its own
            line rather than overflow the dock. */}
        <div className="flex min-w-0 flex-auto">
          <ReplySuggestionControls
            primaryMode={usesTemplatePath ? 'template' : 'ai'}
            primaryExplanation={primaryExplanation}
            tone={state.ai.tone}
            disabled={busy}
            templateDisabled={templateBlockedReason !== null}
            aiDisabled={aiBlockedReason !== null}
            templateUnavailableReason={templateBlockedReason}
            aiUnavailableReason={aiBlockedReason}
            isGenerating={state.ai.isGenerating}
            isLoadingTemplate={state.templates.isLoading}
            hasAiDraft={state.hasAiDraft}
            canUndo={state.historyCount > 0}
            aiError={state.ai.error}
            templateError={state.templates.error}
            errorFixTarget={state.ai.errorFixTarget}
            propertyId={props.propertyId}
            templates={state.templates.templates}
            templateLanguageTag={
              state.templates.library?.groups[0]?.languageGroup ?? null
            }
            languageChoices={languageChoices}
            reviewLanguageReadiness={props.reviewLanguageReadiness}
            onToneChange={state.ai.setTone}
            onRequestAi={state.ai.request}
            onPrepareTemplateMenu={state.templates.prepareMenu}
            onLoadRecommended={state.templates.loadRecommended}
            onLoadTemplate={state.templates.load}
            onLoadLocalSafe={state.templates.loadLocalSafe}
            onUndo={state.undo}
          />
        </div>
        <span
          className={cn(
            'px-1.5 text-xs tabular-nums',
            state.overLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {state.draft.text.length}/{MAX_REPLY_LENGTH}
        </span>
        {/* `ml-auto` keeps the primary against the trailing edge whether the
            foot fits one line or wraps; the footer brings `Delete draft`,
            `Retry save`, the blocked reason and the error line with it, and
            the publication guarantee on `Submit for approval`'s tooltip. */}
        <div className="ml-auto">
          <ReplyComposerFooter
            status={state.autosave.status}
            error={state.autosave.error ?? state.submitError}
            canSubmit={state.canSubmit}
            submitBlockedReason={state.submitBlockedReason}
            disabled={busy}
            isSubmitting={props.isSaving}
            onRetrySave={state.autosave.retry}
            onSubmit={state.submit}
            onDelete={props.onDelete}
          />
        </div>
      </div>
    </div>
  )
}
