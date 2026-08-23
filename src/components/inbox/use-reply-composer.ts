import { useMemo, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import {
  defaultReplyLanguageTag,
  replyLanguageOptions,
  targetForReplyLanguage,
  type ReplyLanguageTarget,
} from './reply-language-options'
import { useReplyAutosave, type ReplyDraftSnapshot } from './use-reply-autosave'
import {
  useReplySuggestion,
  type ReplySuggestionResult,
  type ReplyTone,
} from './use-reply-suggestion'

type Input = Readonly<{
  initialText: string
  initialLanguageTag: string | null
  initialAiGenerated: boolean
  propertyLanguage: string | null
  reviewLanguage: string | null
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmit: () => Promise<unknown>
  onGenerate?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

const validDraft = (draft: ReplyDraftSnapshot) =>
  draft.text.trim().length > 0 && draft.text.length <= MAX_REPLY_LENGTH

export function useReplyComposer(input: Input) {
  const initialTag = defaultReplyLanguageTag({
    savedTag: input.initialLanguageTag,
    propertyTag: input.propertyLanguage,
    reviewTag: input.reviewLanguage,
  })
  const [draft, setDraft] = useState<ReplyDraftSnapshot>({
    text: input.initialText,
    languageTag: initialTag,
  })
  const [hasAiDraft, setHasAiDraft] = useState(input.initialAiGenerated)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const history = useRef<ReplyDraftSnapshot[]>([])
  const revision = useRef(0)
  const options = useMemo(
    () =>
      replyLanguageOptions({
        propertyTag: input.propertyLanguage,
        reviewTag: input.reviewLanguage,
        savedTag: input.initialLanguageTag,
      }),
    [input.initialLanguageTag, input.propertyLanguage, input.reviewLanguage],
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
  const target = targetForReplyLanguage(
    draft.languageTag,
    input.propertyLanguage,
    input.reviewLanguage,
  )
  const ai = useReplySuggestion({
    draft,
    revision,
    target,
    onFlush: async (snapshot) => {
      if (validDraft(snapshot)) await autosave.flush(snapshot)
    },
    onAccept: autosave.acceptAiDraft,
    onAdopt: (nextDraft) => {
      history.current.push(draft)
      setHistoryCount(history.current.length)
      revision.current += 1
      setDraft(nextDraft)
      setHasAiDraft(true)
    },
    onGenerate: input.onGenerate,
  })
  const updateDraft = (next: ReplyDraftSnapshot) => {
    revision.current += 1
    setDraft(next)
    autosave.schedule(next, validDraft(next))
  }
  const undo = () => {
    const previous = history.current.pop()
    if (!previous) return
    setHistoryCount(history.current.length)
    updateDraft(previous)
  }
  const updateLanguage = (languageTag: string) => {
    const next = { ...draft, languageTag }
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
    options,
    autosave,
    ai,
    target,
    hasAiDraft,
    submitError,
    historyCount,
    overLimit: draft.text.length > MAX_REPLY_LENGTH,
    canSubmit: validDraft(draft) && autosave.status !== 'error' && !ai.isGenerating,
    updateText: (text: string) => updateDraft({ ...draft, text }),
    updateLanguage,
    flushOnBlur: () => {
      if (validDraft(draft)) void autosave.flush(draft).catch(() => undefined)
    },
    undo,
    submit,
  }
}
