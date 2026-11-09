import { draftEditMetric, restoredMeasurementSnapshot } from './reply-measurement'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  defaultReplyLanguageTag,
  targetForReplyLanguage,
} from './reply-language-options'
import { createReplyAutosaveCoordinator } from './reply-autosave-coordinator'
import { attachReplyAutosave } from './use-reply-autosave'
import type { ReplyAutosaveState, ReplyDraftSnapshot } from './use-reply-autosave'
import type { ReplyDraftAdoption } from './reply-draft-origin'
import type { ReplyAssistScope } from './reply-suggestion-contract'
import type { LoadedReplyTemplate } from './use-reply-template'
import type { ReplyComposerInput } from './reply-suggestion-contract'
import {
  adoptionRevealsReviewLanguage,
  assistTargetFor,
  draftInLanguage,
  draftInText,
  regenerateScope,
  restoreSnapshot,
  submitAfterSave,
  type LanguageContext,
  type ReplyComposerSnapshot,
} from './reply-composer-transitions'

/**
 * Google's one reply-comment rule (bytes, allowed characters), the same one the
 * server DTO, the use cases and the provider route apply: a draft this refuses
 * is a draft the server would refuse on save.
 */
export const isValidReplyDraft = (draft: ReplyDraftSnapshot) =>
  replyCommentProblem(draft.text) === null

/** The four things the controller asks of the AI assist, wired by the view. */
export type ReplyAiPort = Readonly<{
  dismiss: (explicit?: boolean) => void
  replyEdited: () => void
  restoreMeasurement: (draft: ReplyDraftSnapshot) => void
  request: (
    tone?: undefined,
    templateOnly?: boolean,
    scope?: ReplyAssistScope,
  ) => Promise<void>
}>

export type ReplyComposerBindings = Readonly<{
  ai: ReplyAiPort
  /** Clears the template menu's `Template loaded` announcement. */
  clearLoadedTemplateMessage: () => void
}>

/** What changed the draft, which decides which assist state the change retires. */
export type ReplyComposerEdit = 'type' | 'undo' | 'language' | 'adopt'

export type ReplyComposerControllerState = Readonly<{
  draft: ReplyDraftSnapshot
  selectedLanguage: string | null
  /** The review's language as recorded, or as an adopted AI draft detected it. */
  effectiveReviewLanguage: string | null
  hasAiDraft: boolean
  /** Client provenance for the origin tag, never a server record. */
  adoption: ReplyDraftAdoption | null
  history: ReadonlyArray<ReplyComposerSnapshot>
  autosave: ReplyAutosaveState
}>

export function composerLanguageContext(
  input: Pick<
    ReplyComposerInput,
    'propertyLanguage' | 'reviewLanguageReadiness' | 'reviewLanguage'
  >,
  effectiveReviewLanguage: string | null,
): LanguageContext {
  return {
    propertyLanguage: input.propertyLanguage,
    reviewLanguage:
      input.reviewLanguageReadiness === 'detectable' ? effectiveReviewLanguage : null,
    reviewLanguageReadiness: input.reviewLanguageReadiness,
  }
}

function initialEffectiveReviewLanguage(input: ReplyComposerInput): string | null {
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
}

function initialState(input: ReplyComposerInput): ReplyComposerControllerState {
  const effectiveReviewLanguage = initialEffectiveReviewLanguage(input)
  const reviewLanguage = composerLanguageContext(
    input,
    effectiveReviewLanguage,
  ).reviewLanguage
  const initialTag = defaultReplyLanguageTag({
    savedTag: input.initialLanguageTag,
    propertyTag: input.propertyLanguage,
    reviewTag: reviewLanguage,
  })
  return {
    draft: {
      bodyFrame: input.initialBodyFrame,
      measurementBaseReplyRevision: input.initialMeasurementBaseReplyRevision,
      measurementGenerationId: input.initialMeasurementGenerationId,
      text: input.initialText,
      languageTag: initialTag,
    },
    selectedLanguage:
      initialTag ??
      (input.reviewLanguageReadiness === 'detectable' && reviewLanguage === null
        ? AUTO_DETECT_REVIEW_LANGUAGE
        : null),
    effectiveReviewLanguage,
    hasAiDraft: input.initialAiGenerated,
    adoption: null,
    history: [],
    autosave: { status: 'idle', error: null },
  }
}

/**
 * The reply composer without React: the draft, the language selection, where
 * the draft came from and the Undo history, over the real autosave
 * coordinator. The hook is a view of it (`useSyncExternalStore`), the AI assist
 * and the template library call back into it, and the controller reaches the AI
 * only through `ReplyAiPort`.
 *
 * `connect` is reversible: StrictMode mounts, tears down and mounts again
 * against the same controller, and a second `connect` re-arms the autosave
 * status channel the first one's teardown detached.
 */
export function createReplyComposerController(initialInput: ReplyComposerInput) {
  let input = initialInput
  let bindings: ReplyComposerBindings | null = null
  let state = initialState(initialInput)
  // Every change to the draft moves this on, so an assist answer that started
  // against an earlier one is dropped. The assist hooks read it through
  // `revision`.
  let editRevision = 0
  const listeners = new Set<() => void>()
  const commit = (patch: Partial<ReplyComposerControllerState>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const coordinator = createReplyAutosaveCoordinator({
    initial: {
      measurementBaseReplyRevision: initialInput.initialMeasurementBaseReplyRevision,
      measurementGenerationId: initialInput.initialMeasurementGenerationId,
      text: initialInput.initialText,
      languageTag: initialInput.initialLanguageTag,
    },
    save: (snapshot, provenanceToken) =>
      input.onSaveDraft(
        snapshot.text,
        provenanceToken,
        snapshot.languageTag ?? undefined,
        snapshot.measurementGenerationId,
      ),
    onState: (autosave) => commit({ autosave }),
  })

  const languageContext = () =>
    composerLanguageContext(input, state.effectiveReviewLanguage)
  const isAutoDetecting = () => state.selectedLanguage === AUTO_DETECT_REVIEW_LANGUAGE

  /**
   * One edit's bookkeeping, in the order each event always ran it: retire the
   * AI preview, tell the stream the reply was edited, clear the template
   * announcement, then move the revision. A language change does not tell the
   * stream, and an adoption retires nothing (it is the answer to the preview).
   */
  const noteEdit = (kind: ReplyComposerEdit) => {
    if (kind !== 'adopt') {
      bindings?.ai.dismiss(false)
      if (kind !== 'language') bindings?.ai.replyEdited()
      bindings?.clearLoadedTemplateMessage()
    }
    editRevision += 1
  }

  const editDraft = (
    kind: 'type' | 'undo',
    next: ReplyDraftSnapshot,
    selection = state.selectedLanguage,
  ) => {
    noteEdit(kind)
    commit({ draft: next })
    coordinator.schedule(
      next,
      isValidReplyDraft(next) && selection !== AUTO_DETECT_REVIEW_LANGUAGE,
    )
  }

  const adopt = (
    nextDraft: ReplyDraftSnapshot,
    kind: ReplyDraftAdoption['kind'],
    template: LoadedReplyTemplate | null = null,
  ) => {
    const history = [
      ...state.history,
      { draft: state.draft, adoption: state.adoption, hasAiDraft: state.hasAiDraft },
    ]
    noteEdit('adopt')
    const adoption = { kind, languageTag: nextDraft.languageTag, template }
    commit({
      history,
      effectiveReviewLanguage: adoptionRevealsReviewLanguage(
        adoption,
        input.propertyLanguage,
      )
        ? nextDraft.languageTag
        : state.effectiveReviewLanguage,
      selectedLanguage: nextDraft.languageTag,
      draft: nextDraft,
      hasAiDraft: kind === 'personalized',
      adoption,
    })
  }

  // Undo puts back the draft AND its provenance (`ReplyComposerSnapshot`), so
  // the result tag never names the source of the draft that was undone.
  const undo = () => {
    const previous = state.history.at(-1)
    if (!previous) return
    const restored = restoreSnapshot(previous, {
      detectedReviewLanguage: state.effectiveReviewLanguage,
      reviewLanguageReadiness: input.reviewLanguageReadiness,
    })
    commit({ history: state.history.slice(0, -1) })
    bindings?.ai.restoreMeasurement(restored.snapshot.draft)
    commit({
      selectedLanguage: restored.selection,
      adoption: restored.snapshot.adoption,
      hasAiDraft: restored.snapshot.hasAiDraft,
    })
    editDraft(
      'undo',
      restoredMeasurementSnapshot(restored.snapshot.draft),
      restored.selection,
    )
  }

  // The autosave branches are the select's: the sentinel is scheduled with
  // `canSave` false — an auto-detect draft must not persist a language it has
  // not resolved — and a concrete tag is flushed at once when the draft is
  // valid, scheduled unsaved when it is not. An EMPTY box is left alone: there
  // is nothing to save, and scheduling it printed and announced `Not saved`
  // for a language pick on a composer nobody had written in.
  const updateLanguage = (languageTag: string): ReplyAssistScope => {
    const next = draftInLanguage(state.draft, languageTag)
    noteEdit('language')
    commit({ selectedLanguage: languageTag, draft: next })
    const hasText = next.text.trim().length > 0
    const canSave = languageTag !== AUTO_DETECT_REVIEW_LANGUAGE && isValidReplyDraft(next)
    // `schedule` first even when flushing at once: it is what re-emits `Saved`
    // for a draft identical to the last save (back from detection to the
    // language it was saved in), which `flush` alone leaves reading `Not saved`.
    if (hasText) coordinator.schedule(next, canSave)
    if (hasText && canSave) void coordinator.flush(next).catch(() => undefined)
    return { draft: next, target: assistTargetFor(languageTag, languageContext()) }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    /** Attach the autosave status channel; the returned teardown sends unsaved text. */
    connect: () => attachReplyAutosave(coordinator, (autosave) => commit({ autosave })),
    /** The latest props, read when an event runs. */
    setInput(next: ReplyComposerInput) {
      input = next
    },
    bind(next: ReplyComposerBindings) {
      bindings = next
    },
    revision: {
      get current() {
        return editRevision
      },
    },
    retrySave: () => coordinator.retry(),
    typeText: (text: string) => editDraft('type', draftInText(state.draft, text)),
    undo,
    updateLanguage,
    adopt,
    regenerateIn: (languageTag: string) =>
      bindings?.ai.request(
        undefined,
        false,
        regenerateScope(state.draft, languageTag, languageContext()),
      ) ?? Promise.resolve(),
    blur() {
      if (isValidReplyDraft(state.draft) && !isAutoDetecting())
        void coordinator.flush(state.draft).catch(() => undefined)
    },
    /** One draft per call: the one saved is the one the metric describes. */
    async submit() {
      const draft = state.draft
      await submitAfterSave(
        () => coordinator.flush(draft),
        () => input.onSubmit(draftEditMetric(draft)),
      )
    },
    /** Deleting a draft is the server's business; the box and autosave are left as they are. */
    deleteDraft: <T>(run: () => Promise<T>) => run(),
    // The AI assist's calls.
    flushForAi: async (snapshot: ReplyDraftSnapshot) => {
      if (isValidReplyDraft(snapshot) && !isAutoDetecting())
        await coordinator.flush(snapshot)
    },
    acceptAiDraft: async (draft: ReplyDraftSnapshot, provenanceToken: string | null) => {
      if (provenanceToken === null) await coordinator.flush(draft)
      else await coordinator.acceptAiDraft(draft, provenanceToken)
    },
    // The template library's calls.
    acceptTemplateDraft: (draft: ReplyDraftSnapshot) => coordinator.flush(draft),
    serverDraftUnknown: coordinator.invalidate,
    loadLocalSafe: () => bindings?.ai.request(undefined, true) ?? Promise.resolve(),
    dismissSuggestion: () => bindings?.ai.dismiss(false),
  }
}

export type ReplyComposerController = ReturnType<typeof createReplyComposerController>
