import { useMemo, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  defaultReplyLanguageTag,
  replyLanguageOptions,
  targetForReplyLanguage,
} from './reply-language-options'
import type { ReplyComposerInput } from './reply-suggestion-contract'
import { useReplyAutosave, type ReplyDraftSnapshot } from './use-reply-autosave'
import { useReplySuggestion } from './use-reply-suggestion'

const validDraft = (draft: ReplyDraftSnapshot) =>
  draft.text.trim().length > 0 && draft.text.length <= MAX_REPLY_LENGTH

export function useReplyComposer(input: ReplyComposerInput) {
  const [effectiveReviewLanguage, setEffectiveReviewLanguage] = useState<string | null>(
    () => {
      if (input.reviewLanguage) return input.reviewLanguage
      if (!input.initialAiGenerated || !input.initialLanguageTag) return null
      return targetForReplyLanguage(
        input.initialLanguageTag,
        input.propertyLanguage,
        input.reviewLanguage,
      ) === null
        ? input.initialLanguageTag
        : null
    },
  )
  const initialTag = defaultReplyLanguageTag({
    savedTag: input.initialLanguageTag,
    propertyTag: input.propertyLanguage,
    reviewTag: effectiveReviewLanguage,
  })
  const [draft, setDraft] = useState<ReplyDraftSnapshot>({
    text: input.initialText,
    languageTag: initialTag,
  })
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(
    initialTag ??
      (input.canDetectReviewLanguage && effectiveReviewLanguage === null
        ? AUTO_DETECT_REVIEW_LANGUAGE
        : null),
  )
  const [hasAiDraft, setHasAiDraft] = useState(input.initialAiGenerated)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const history = useRef<ReplyDraftSnapshot[]>([])
  const revision = useRef(0)
  const options = useMemo(
    () =>
      replyLanguageOptions({
        propertyTag: input.propertyLanguage,
        reviewTag: effectiveReviewLanguage,
        savedTag: input.initialLanguageTag,
        canDetectReviewLanguage: input.canDetectReviewLanguage,
      }),
    [
      effectiveReviewLanguage,
      input.canDetectReviewLanguage,
      input.initialLanguageTag,
      input.propertyLanguage,
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
  const target = targetForReplyLanguage(
    selectedLanguage,
    input.propertyLanguage,
    effectiveReviewLanguage,
    { canDetectReviewLanguage: input.canDetectReviewLanguage },
  )
  const ai = useReplySuggestion({
    draft,
    revision,
    target,
    onFlush: async (snapshot) => {
      if (validDraft(snapshot) && !isAutoDetectingLanguage) await autosave.flush(snapshot)
    },
    onAccept: async (nextDraft, provenanceToken) => {
      if (provenanceToken === null) await autosave.flush(nextDraft)
      else await autosave.acceptAiDraft(nextDraft, provenanceToken)
    },
    onAdopt: (nextDraft, kind) => {
      history.current.push(draft)
      setHistoryCount(history.current.length)
      revision.current += 1
      if (target?.kind === 'review_language')
        setEffectiveReviewLanguage(nextDraft.languageTag)
      setSelectedLanguage(nextDraft.languageTag)
      setDraft(nextDraft)
      setHasAiDraft(kind === 'personalized')
    },
    onGenerate: input.onGenerate,
  })
  const updateDraft = (next: ReplyDraftSnapshot, nextSelection = selectedLanguage) => {
    ai.dismiss()
    revision.current += 1
    setDraft(next)
    autosave.schedule(
      next,
      validDraft(next) && nextSelection !== AUTO_DETECT_REVIEW_LANGUAGE,
    )
  }
  const undo = () => {
    const previous = history.current.pop()
    if (!previous) return
    setHistoryCount(history.current.length)
    const restored =
      previous.languageTag === null && effectiveReviewLanguage !== null
        ? { ...previous, languageTag: effectiveReviewLanguage }
        : previous
    const previousSelection =
      restored.languageTag ??
      (input.canDetectReviewLanguage ? AUTO_DETECT_REVIEW_LANGUAGE : null)
    const resetDetectedLanguage =
      previousSelection === AUTO_DETECT_REVIEW_LANGUAGE && input.reviewLanguage === null
    if (resetDetectedLanguage) setEffectiveReviewLanguage(null)
    setSelectedLanguage(previousSelection)
    updateDraft(restored, previousSelection)
  }
  const updateLanguage = (languageTag: string) => {
    ai.dismiss()
    if (languageTag === AUTO_DETECT_REVIEW_LANGUAGE) {
      const next = { ...draft, languageTag: null }
      setSelectedLanguage(languageTag)
      revision.current += 1
      setDraft(next)
      autosave.schedule(next, false)
      return
    }
    const next = { ...draft, languageTag }
    setSelectedLanguage(languageTag)
    revision.current += 1
    setDraft(next)
    if (validDraft(next)) void autosave.flush(next).catch(() => undefined)
    else autosave.schedule(next, false)
  }
  const submit = async () => {
    setSubmitError(null)
    try {
      await autosave.flush(draft)
      await input.onSubmit()
    } catch {
      setSubmitError('Save the draft successfully before submitting it.')
    }
  }

  return {
    draft,
    selectedLanguage,
    isAutoDetectingLanguage,
    options,
    autosave,
    ai,
    target,
    hasAiDraft,
    submitError,
    historyCount,
    overLimit: draft.text.length > MAX_REPLY_LENGTH,
    canSubmit:
      !isAutoDetectingLanguage &&
      validDraft(draft) &&
      autosave.status !== 'error' &&
      !ai.isGenerating &&
      !ai.isAdopting,
    updateText: (text: string) => updateDraft({ ...draft, text }),
    updateLanguage,
    flushOnBlur: () => {
      if (validDraft(draft) && !isAutoDetectingLanguage)
        void autosave.flush(draft).catch(() => undefined)
    },
    undo,
    submit,
  }
}
