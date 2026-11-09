import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as replyRules from '#/contexts/review/application/public-api'
import {
  GOOGLE_REPLY_COMMENT_MAX_BYTES,
  replyCommentByteLength,
} from '#/shared/google-provider-control/reply-comment'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  replyLanguageOptions,
  type ReplyLanguageOption,
} from './reply-language-options'
import type { ReplyComposerInput } from './reply-suggestion-contract'
import { isReloadSafe } from './reply-autosave-coordinator'
import { useReplySuggestion, type ReplyAssistScope } from './use-reply-suggestion'
import { useReplyTemplate } from './use-reply-template'
import { useReplyDraftChecks } from './use-reply-draft-checks'
import { replyDraftOrigin } from './reply-draft-origin'
import {
  hasPropertyDefaultOption,
  unresolvedLanguageSubmitReason,
} from './reply-assist-language'
import { assistTargetFor } from './reply-composer-transitions'
import {
  composerLanguageContext,
  createReplyComposerController,
  isValidReplyDraft,
} from './reply-composer-controller'

export type { ReplyDraftOrigin } from './reply-draft-origin'
export type { ReplyAssistScope } from './use-reply-suggestion'
export { assistTargetFor, draftInLanguage } from './reply-composer-transitions'

/**
 * Everything the language controls need to choose the language the assist
 * actions act in (rows 17, 18), as one value rather than loose fields on the
 * composer.
 *
 * The language left the chrome because it only ever chooses between two
 * targets, the property default and the review's language
 * (`ReplyLanguageTarget`, `reply-language-options.ts`), and the server reads it
 * only for the two assist actions: the template library is filtered by the
 * target's `templateGroup` (`reply-template-operations.ts:137`) and a loaded
 * template stamps `replyLanguageTag` on the draft (`:304`); an accepted AI
 * draft stamps the same tag (`ai-suggested-draft-store.ts:360`); a hand-typed
 * reply only records it (`reply-operations.ts:325`) and nothing reads it at
 * publish.
 *
 * The CLIENT does read it for a hand-typed reply, though, and the PR 4 review
 * was right that the plan missed it: while the selection is automatic
 * detection the draft is never autosaved and never submitted (`canSubmit`,
 * `flushOnBlur`, `updateDraft` below — an unresolved draft must not persist a
 * stale tag, which `reply-operations.ts:325` would keep). So the choice is
 * shown, not only held: `Draft with AI ▾` (`Write in`) and `Template ▾` (its
 * switch) both take this value, and Submit carries
 * `unresolvedLanguageSubmitReason` while detection is pending.
 */
export type ReplyLanguageChoices = Readonly<{
  /** `replyLanguageOptions` — property default, review language (or the
   *  `Detect automatically` sentinel with its `disabledReason`), and a saved
   *  draft's own tag when it matches neither. */
  options: ReadonlyArray<ReplyLanguageOption>
  /** A language tag, `AUTO_DETECT_REVIEW_LANGUAGE`, or `null` when nothing
   *  is selected (no property default and no detectable review). */
  selectedTag: string | null
  /** `selectedTag === AUTO_DETECT_REVIEW_LANGUAGE`. While true the draft has
   *  not resolved its language: it is never autosaved and never submitted. */
  isAutoDetecting: boolean
  /**
   * Whether the review's language came from the SERVER (`reviewReplyLanguage`)
   * rather than from an AI draft's detection. Only a recorded language can
   * filter the template library (`templateLanguageOptions`).
   */
  isReviewLanguageRecorded: boolean
  /**
   * Selects a language, with the autosave rules the select had: a sentinel
   * draft is scheduled but never saved, a valid concrete draft is flushed at
   * once, an invalid one is scheduled unsaved, and an EMPTY box is left alone.
   * Returns the scope the change committed; `templates.prepareMenu` takes its
   * target when the same event goes on to list templates in that language.
   */
  updateLanguage: (languageTag: string) => ReplyAssistScope
}>

// fallow-ignore-next-line complexity -- the view of the composer controller wires the AI assist, the template library and the draft checks
export function useReplyComposer(input: ReplyComposerInput) {
  const [controller] = useState(() => createReplyComposerController(input))
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const { draft, selectedLanguage, adoption, hasAiDraft, autosave } = state
  const reviewLanguage =
    input.reviewLanguageReadiness === 'detectable' ? state.effectiveReviewLanguage : null
  const languageContext = composerLanguageContext(input, state.effectiveReviewLanguage)
  const draftChecks = useReplyDraftChecks(draft.text, input.onCheckDraft)
  const options = useMemo(
    () =>
      replyLanguageOptions({
        propertyTag: input.propertyLanguage,
        reviewTag: reviewLanguage,
        savedTag: input.initialLanguageTag,
        reviewLanguageReadiness: input.reviewLanguageReadiness,
      }),
    [
      input.initialLanguageTag,
      input.propertyLanguage,
      input.reviewLanguageReadiness,
      reviewLanguage,
    ],
  )
  const isAutoDetectingLanguage = selectedLanguage === AUTO_DETECT_REVIEW_LANGUAGE
  const target = assistTargetFor(selectedLanguage, languageContext)
  const ai = useReplySuggestion({
    draft,
    revision: controller.revision,
    target,
    onFlush: controller.flushForAi,
    onAccept: controller.acceptAiDraft,
    onAdopt: controller.adopt,
    onGenerate: input.onGenerate,
    onMeasure: input.onMeasure,
    initialMeasurementGenerationId: input.initialMeasurementGenerationId,
    initialMeasurementBaseReplyRevision: input.initialMeasurementBaseReplyRevision,
  })
  const templates = useReplyTemplate({
    target,
    revision: controller.revision,
    onList: input.onListTemplates,
    onLoad: input.onLoadTemplate,
    onAccept: controller.acceptTemplateDraft,
    onServerDraftUnknown: controller.serverDraftUnknown,
    onAdopt: (nextDraft, template) =>
      controller.adopt(nextDraft, 'library_template', template),
    onLoadLocalSafe: controller.loadLocalSafe,
    onDismissSuggestion: controller.dismissSuggestion,
  })
  const { dismiss, request, restoreMeasurement } = ai
  const replyEdited = () => ai.stream.session?.replyEdited()
  const { clearLoadedMessage } = templates
  useEffect(() => {
    controller.setInput(input)
    controller.bind({
      ai: { dismiss, replyEdited, restoreMeasurement, request },
      clearLoadedTemplateMessage: clearLoadedMessage,
    })
  })
  useEffect(() => controller.connect(), [controller])

  const languageChoices: ReplyLanguageChoices = {
    options,
    selectedTag: selectedLanguage,
    isAutoDetecting: isAutoDetectingLanguage,
    isReviewLanguageRecorded: input.reviewLanguage !== null,
    updateLanguage: controller.updateLanguage,
  }
  // Submit's reason while the language is unresolved — see
  // `unresolvedLanguageSubmitReason`. Only once there is text: an empty box is
  // already refused by `isValidReplyDraft`, and a reason under it would be noise.
  const submitBlockedReason =
    (draftChecks && draftChecks.blocks.length > 0
      ? 'Fix the blocked reply checks before submitting.'
      : null) ??
    replyRules.unfilledReplySlotsMessage(draft.text) ??
    (isAutoDetectingLanguage && isValidReplyDraft(draft)
      ? unresolvedLanguageSubmitReason(hasPropertyDefaultOption(options))
      : null)
  // The footer never calls this while `canSubmit` is false, and `canSubmit`
  // requires no blocked reason, so the early return is a guard only: the
  // reason is already on screen, in the footer's own line.
  const submit = async () => {
    if (submitBlockedReason !== null) return
    await controller.submit()
  }

  return {
    draft,
    languageChoices,
    draftOrigin: replyDraftOrigin({
      hasAiDraft,
      adoption,
      savedLanguageTag: input.initialLanguageTag,
    }),
    autosave: {
      status: autosave.status,
      error: autosave.error,
      reloadSafe: isReloadSafe(autosave.status),
      retry: controller.retrySave,
    },
    ai,
    templates,
    draftChecks,
    target,
    hasAiDraft,
    historyCount: state.history.length,
    overLimit: replyCommentByteLength(draft.text) > GOOGLE_REPLY_COMMENT_MAX_BYTES,
    canSubmit:
      !isAutoDetectingLanguage &&
      isValidReplyDraft(draft) &&
      submitBlockedReason === null &&
      autosave.status !== 'error' &&
      !ai.isAdopting,
    submitBlockedReason,
    updateText: controller.typeText,
    flushOnBlur: controller.blur,
    undo: controller.undo,
    deleteDraft: controller.deleteDraft,
    anotherWording:
      adoption?.kind === 'library_template' &&
      adoption.template?.hasAlternativeWording === true
        ? () => templates.loadAnother(adoption.template!)
        : null,
    anotherWordingNeedsConfirmation:
      adoption?.kind === 'library_template' &&
      adoption.template?.originalText !== undefined
        ? draft.text !== adoption.template.originalText
        : false,
    // Row 18's regenerate: asks in `languageTag` without selecting it — the
    // language commits only if the preview is adopted (`regenerateScope`).
    regenerateIn: controller.regenerateIn,
    submit,
  }
}
