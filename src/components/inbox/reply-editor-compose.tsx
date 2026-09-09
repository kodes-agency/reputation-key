import { Sparkles } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from '#/components/ui/input-group'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import { ReplyComposerFooter } from './reply-composer-footer'
import { ReplyLanguageSelect } from './reply-language-select'
import { ReplyLanguageReadiness } from './reply-language-readiness'
import {
  languageDisplayName,
  type ReplyLanguageTarget,
  type ReviewLanguageReadiness,
} from './reply-language-options'
import { ReplySuggestionControls } from './reply-suggestion-controls'
import { ReplySuggestionPreview } from './reply-suggestion-preview'
import { ReplyToolbarPortal } from './reply-toolbar-slot'
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

  return (
    <div className="flex flex-col gap-4">
      <ReplyToolbarPortal>
        <ReplyLanguageSelect
          value={state.selectedLanguage}
          options={state.options}
          disabled={busy}
          onChange={state.updateLanguage}
        />
      </ReplyToolbarPortal>
      <ReplyLanguageReadiness
        propertyId={props.propertyId}
        hasPropertyDefault={props.propertyDefaultReplyLanguage !== null}
        reviewLanguageReadiness={props.reviewLanguageReadiness}
        isAutoDetecting={state.isAutoDetectingLanguage}
      />
      {state.ai.suggestion && (
        <ReplySuggestionPreview
          suggestion={state.ai.suggestion}
          propertyLanguage={props.propertyDefaultReplyLanguage}
          disabled={busy}
          isAdopting={state.ai.isAdopting}
          onAdopt={() => void state.ai.adopt()}
          onDismiss={state.ai.dismiss}
        />
      )}
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
          disabled={props.isSaving || state.ai.isAdopting || state.templates.isLoading}
          onChange={(event) => state.updateText(event.target.value)}
          onBlur={state.flushOnBlur}
        />
        <InputGroupAddon align="block-end" className="flex-wrap gap-2 border-t">
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
            hasAiDraft={state.hasAiDraft || state.ai.suggestion !== null}
            canUndo={state.historyCount > 0}
            aiError={state.ai.error}
            templateError={state.templates.error}
            errorFixTarget={state.ai.errorFixTarget}
            propertyId={props.propertyId}
            templates={state.templates.templates}
            onToneChange={state.ai.setTone}
            onRequestAi={state.ai.request}
            onPrepareTemplateMenu={state.templates.prepareMenu}
            onLoadRecommended={state.templates.loadRecommended}
            onLoadTemplate={state.templates.load}
            onLoadLocalSafe={state.templates.loadLocalSafe}
            onUndo={state.undo}
          />
          {state.templates.loadedMessage && (
            <p role="status" className="basis-full text-xs text-muted-foreground">
              {state.templates.loadedMessage}
            </p>
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
        languageName={
          state.isAutoDetectingLanguage
            ? null
            : languageDisplayName(state.draft.languageTag)
        }
        canSubmit={state.canSubmit}
        submitBlockedReason={state.submitBlockedReason}
        disabled={busy}
        isSubmitting={props.isSaving}
        onRetrySave={state.autosave.retry}
        onSubmit={state.submit}
        onDelete={props.onDelete}
      />
    </div>
  )
}
