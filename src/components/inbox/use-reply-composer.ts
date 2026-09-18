import { useMemo, useRef, useState } from 'react'
import { unfilledReplySlotsMessage } from '#/contexts/review/application/public-api'
import {
  GOOGLE_REPLY_COMMENT_MAX_BYTES,
  replyCommentByteLength,
  replyCommentProblem,
} from '#/shared/google-provider-control/reply-comment'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  defaultReplyLanguageTag,
  replyLanguageOptions,
  targetForReplyLanguage,
  type ReplyLanguageOption,
} from './reply-language-options'
import type { ReplyComposerInput } from './reply-suggestion-contract'
import { useReplyAutosave, type ReplyDraftSnapshot } from './use-reply-autosave'
import { useReplySuggestion, type ReplyAssistScope } from './use-reply-suggestion'
import { useReplyTemplate, type LoadedReplyTemplate } from './use-reply-template'
import { replyDraftOrigin, type ReplyDraftAdoption } from './reply-draft-origin'
import {
  hasPropertyDefaultOption,
  unresolvedLanguageSubmitReason,
} from './reply-assist-language'
import {
  adoptionRevealsReviewLanguage,
  assistTargetFor,
  draftInLanguage,
  regenerateScope,
  restoreSnapshot,
  submitAfterSave,
  type LanguageContext,
  type ReplyComposerSnapshot,
} from './reply-composer-transitions'

export type { ReplyDraftOrigin } from './reply-draft-origin'
export type { ReplyAssistScope } from './use-reply-suggestion'
export { assistTargetFor, draftInLanguage } from './reply-composer-transitions'

// Google's one reply-comment rule (bytes, allowed characters), the same one the
// server DTO, the use cases and the provider route apply: a draft this refuses
// is a draft the server would refuse on save.
const validDraft = (draft: ReplyDraftSnapshot) => replyCommentProblem(draft.text) === null

function useReplyComposerHistory() {
  const [count, setCount] = useState(0)
  const entries = useRef<ReadonlyArray<ReplyComposerSnapshot>>([])
  const revision = useRef(0)
  const replace = (next: ReadonlyArray<ReplyComposerSnapshot>) => {
    entries.current = next
    setCount(next.length)
  }
  const advanceRevision = () => {
    revision.current += 1
  }
  return { count, entries, revision, replace, advanceRevision }
}

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

export function useReplyComposer(input: ReplyComposerInput) {
  const [effectiveReviewLanguage, setEffectiveReviewLanguage] = useState<string | null>(
    () => {
      if (input.reviewLanguageReadiness !== 'detectable') return null
      if (input.reviewLanguage) return input.reviewLanguage
      if (!input.initialAiGenerated || !input.initialLanguageTag) return null
      return targetForReplyLanguage(
        input.initialLanguageTag,
        input.propertyLanguage,
        input.reviewLanguage,
        input.reviewLanguageReadiness,
      ) === null
        ? input.initialLanguageTag
        : null
    },
  )
  const reviewLanguage =
    input.reviewLanguageReadiness === 'detectable' ? effectiveReviewLanguage : null
  const languageContext: LanguageContext = {
    propertyLanguage: input.propertyLanguage,
    reviewLanguage,
    reviewLanguageReadiness: input.reviewLanguageReadiness,
  }
  const initialTag = defaultReplyLanguageTag({
    savedTag: input.initialLanguageTag,
    propertyTag: input.propertyLanguage,
    reviewTag: reviewLanguage,
  })
  const [draft, setDraft] = useState<ReplyDraftSnapshot>({
    text: input.initialText,
    languageTag: initialTag,
  })
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(
    initialTag ??
      (input.reviewLanguageReadiness === 'detectable' && reviewLanguage === null
        ? AUTO_DETECT_REVIEW_LANGUAGE
        : null),
  )
  const [hasAiDraft, setHasAiDraft] = useState(input.initialAiGenerated)
  // Client provenance for row 18's tag, never a server record: a literal `null`
  // seed, so the product-state ledger has nothing to classify. Why it is not
  // seeded from the saved reply is `replyDraftOrigin`'s comment.
  const [adoption, setAdoption] = useState<ReplyDraftAdoption | null>(null)
  const history = useReplyComposerHistory()
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
  const autosave = useReplyAutosave(
    {
      text: input.initialText,
      languageTag: input.initialLanguageTag,
    },
    (snapshot, provenanceToken) =>
      input.onSaveDraft(
        snapshot.text,
        provenanceToken,
        snapshot.languageTag ?? undefined,
      ),
  )
  const isAutoDetectingLanguage = selectedLanguage === AUTO_DETECT_REVIEW_LANGUAGE
  const target = assistTargetFor(selectedLanguage, languageContext)
  const adoptDraft = (
    nextDraft: ReplyDraftSnapshot,
    kind: ReplyDraftAdoption['kind'],
    template: LoadedReplyTemplate | null = null,
  ) => {
    history.replace([...history.entries.current, { draft, adoption, hasAiDraft }])
    history.advanceRevision()
    const next = { kind, languageTag: nextDraft.languageTag, template }
    if (adoptionRevealsReviewLanguage(next, input.propertyLanguage))
      setEffectiveReviewLanguage(nextDraft.languageTag)
    setSelectedLanguage(nextDraft.languageTag)
    setDraft(nextDraft)
    setHasAiDraft(kind === 'personalized')
    setAdoption(next)
  }
  const ai = useReplySuggestion({
    draft,
    revision: history.revision,
    target,
    onFlush: async (snapshot) => {
      if (validDraft(snapshot) && !isAutoDetectingLanguage) await autosave.flush(snapshot)
    },
    onAccept: async (nextDraft, provenanceToken) => {
      if (provenanceToken === null) await autosave.flush(nextDraft)
      else await autosave.acceptAiDraft(nextDraft, provenanceToken)
    },
    onAdopt: adoptDraft,
    onGenerate: input.onGenerate,
  })
  const templates = useReplyTemplate({
    target,
    revision: history.revision,
    onList: input.onListTemplates,
    onLoad: input.onLoadTemplate,
    onAccept: (nextDraft) => autosave.flush(nextDraft),
    onServerDraftUnknown: autosave.invalidate,
    onAdopt: (nextDraft, template) => adoptDraft(nextDraft, 'library_template', template),
    onLoadLocalSafe: () => ai.request(undefined, true),
    onDismissSuggestion: ai.dismiss,
  })
  const updateDraft = (next: ReplyDraftSnapshot, nextSelection = selectedLanguage) => {
    ai.dismiss()
    templates.clearLoadedMessage()
    history.advanceRevision()
    setDraft(next)
    autosave.schedule(
      next,
      validDraft(next) && nextSelection !== AUTO_DETECT_REVIEW_LANGUAGE,
    )
  }
  // Undo puts back the draft AND its provenance (`ReplyComposerSnapshot`), so
  // the result tag never names the source of the draft that was undone.
  const undo = () => {
    const previous = history.entries.current.at(-1)
    if (!previous) return
    history.replace(history.entries.current.slice(0, -1))
    const restored = restoreSnapshot(previous, {
      detectedReviewLanguage: effectiveReviewLanguage,
      reviewLanguageReadiness: input.reviewLanguageReadiness,
    })
    setSelectedLanguage(restored.selection)
    setAdoption(restored.snapshot.adoption)
    setHasAiDraft(restored.snapshot.hasAiDraft)
    updateDraft(restored.snapshot.draft, restored.selection)
  }
  // The autosave branches are the select's: the sentinel is scheduled with
  // `canSave` false — an auto-detect draft must not persist a language it has
  // not resolved — and a concrete tag is flushed at once when the draft is
  // valid, scheduled unsaved when it is not. An EMPTY box is left alone: there
  // is nothing to save, and scheduling it printed and announced `Not saved`
  // for a language pick on a composer nobody had written in (PR 4 review),
  // which `composer-mode-row.tsx` rules out for an empty box.
  const updateLanguage = (languageTag: string): ReplyAssistScope => {
    ai.dismiss()
    templates.clearLoadedMessage()
    const next = draftInLanguage(draft, languageTag)
    setSelectedLanguage(languageTag)
    history.advanceRevision()
    setDraft(next)
    const hasText = next.text.trim().length > 0
    const canSave = languageTag !== AUTO_DETECT_REVIEW_LANGUAGE && validDraft(next)
    // `schedule` first even when flushing at once: it is what re-emits `Saved`
    // for a draft identical to the last save (back from detection to the
    // language it was saved in), which `flush` alone leaves reading `Not saved`.
    if (hasText) autosave.schedule(next, canSave)
    if (hasText && canSave) void autosave.flush(next).catch(() => undefined)
    return { draft: next, target: assistTargetFor(languageTag, languageContext) }
  }
  const languageChoices: ReplyLanguageChoices = {
    options,
    selectedTag: selectedLanguage,
    isAutoDetecting: isAutoDetectingLanguage,
    isReviewLanguageRecorded: input.reviewLanguage !== null,
    updateLanguage,
  }
  // Submit's reason while the language is unresolved — see
  // `unresolvedLanguageSubmitReason`. Only once there is text: an empty box is
  // already refused by `validDraft`, and a reason under it would be noise.
  const submitBlockedReason =
    unfilledReplySlotsMessage(draft.text) ??
    (isAutoDetectingLanguage && validDraft(draft)
      ? unresolvedLanguageSubmitReason(hasPropertyDefaultOption(options))
      : null)
  // The footer never calls this while `canSubmit` is false, and `canSubmit`
  // requires no blocked reason, so the early return is a guard only: the
  // reason is already on screen, in the footer's own line.
  const submit = async () => {
    if (submitBlockedReason !== null) return
    await submitAfterSave(() => autosave.flush(draft), input.onSubmit)
  }

  return {
    draft,
    languageChoices,
    draftOrigin: replyDraftOrigin({
      hasAiDraft,
      adoption,
      savedLanguageTag: input.initialLanguageTag,
    }),
    autosave,
    ai,
    templates,
    target,
    hasAiDraft,
    historyCount: history.count,
    overLimit: replyCommentByteLength(draft.text) > GOOGLE_REPLY_COMMENT_MAX_BYTES,
    canSubmit:
      !isAutoDetectingLanguage &&
      validDraft(draft) &&
      submitBlockedReason === null &&
      autosave.status !== 'error' &&
      !ai.isGenerating &&
      !ai.isAdopting,
    submitBlockedReason,
    updateText: (text: string) => updateDraft({ ...draft, text }),
    flushOnBlur: () => {
      if (validDraft(draft) && !isAutoDetectingLanguage)
        void autosave.flush(draft).catch(() => undefined)
    },
    undo,
    // Row 18's regenerate: asks in `languageTag` without selecting it — the
    // language commits only if the preview is adopted (`regenerateScope`).
    regenerateIn: (languageTag: string) =>
      ai.request(undefined, false, regenerateScope(draft, languageTag, languageContext)),
    submit,
  }
}
