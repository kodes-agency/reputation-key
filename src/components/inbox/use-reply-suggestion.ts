import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'

export type ReplyTone = 'professional' | 'friendly' | 'casual'
export type ReplySuggestionResult =
  | Readonly<{
      status: 'ready'
      replyText: string
      provenanceToken: string
      expiresAtEpochMillis: number
      baseReplyStateRevision: number
    }>
  | Readonly<{
      status: 'unavailable'
      code: string
      retryAfterEpochMillis: number | null
    }>

export type ReplySuggestion = Readonly<{
  text: string
  provenanceToken: string
  expiresAtEpochMillis: number
  baseReplyStateRevision: number
  baseText: string
  baseTextRevision: number
}>

type UseReplySuggestionInput = Readonly<{
  initialText: string
  onSaveDraft: (text: string, provenanceToken?: string) => Promise<unknown>
  onGenerateSuggestion?: (tone: ReplyTone) => Promise<ReplySuggestionResult>
}>

const unavailableMessage = (code: string): string => {
  if (code === 'language_not_supported')
    return 'A suggestion is not available for this review language.'
  if (code === 'not_authorized')
    return 'AI reply suggestions are not enabled for this property.'
  if (code === 'source_changed')
    return 'The review changed. Reload it before requesting a suggestion.'
  return 'A suggestion is unavailable right now. Try again.'
}

export function useReplySuggestion({
  initialText,
  onSaveDraft,
  onGenerateSuggestion,
}: UseReplySuggestionInput) {
  const [text, setText] = useState(initialText)
  const [tone, setTone] = useState<ReplyTone>('professional')
  const [suggestion, setSuggestion] = useState<ReplySuggestion | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAdopting, setIsAdopting] = useState(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [isUseDialogOpen, setIsUseDialogOpen] = useState(false)
  const requestSequence = useRef(0)
  const textRevision = useRef(0)

  const clearSuggestion = useCallback(() => {
    requestSequence.current += 1
    setSuggestion(null)
    setIsUseDialogOpen(false)
    setSuggestionError(null)
    setIsGenerating(false)
  }, [])

  useEffect(() => {
    if (!suggestion) return
    const remaining = Math.max(0, suggestion.expiresAtEpochMillis - Date.now())
    const timer = window.setTimeout(clearSuggestion, remaining)
    return () => window.clearTimeout(timer)
  }, [clearSuggestion, suggestion])

  useEffect(() => {
    const clearOnPageHide = () => clearSuggestion()
    window.addEventListener('pagehide', clearOnPageHide)
    return () => window.removeEventListener('pagehide', clearOnPageHide)
  }, [clearSuggestion])

  const requestSuggestion = async () => {
    if (!onGenerateSuggestion) return
    const baseText = text
    setSuggestion(null)
    setIsUseDialogOpen(false)
    const sequence = ++requestSequence.current
    const revision = textRevision.current
    setIsGenerating(true)
    setSuggestionError(null)
    try {
      const result = await onGenerateSuggestion(tone)
      if (sequence !== requestSequence.current || revision !== textRevision.current)
        return
      if (result.status === 'unavailable') {
        setSuggestionError(unavailableMessage(result.code))
        return
      }
      if (
        result.replyText.length === 0 ||
        result.replyText.length > MAX_REPLY_LENGTH ||
        result.expiresAtEpochMillis <= Date.now()
      ) {
        setSuggestionError('A suggestion is unavailable right now. Try again.')
        return
      }
      setSuggestion({
        text: result.replyText,
        provenanceToken: result.provenanceToken,
        expiresAtEpochMillis: result.expiresAtEpochMillis,
        baseReplyStateRevision: result.baseReplyStateRevision,
        baseText,
        baseTextRevision: revision,
      })
    } catch {
      if (sequence === requestSequence.current) {
        setSuggestionError('A suggestion is unavailable right now. Try again.')
      }
    } finally {
      if (sequence === requestSequence.current) setIsGenerating(false)
    }
  }

  const suggestionMatchesCurrentDraft = (): boolean =>
    suggestion !== null &&
    suggestion.baseTextRevision === textRevision.current &&
    suggestion.baseText === text

  const openUseDialog = () => {
    if (!suggestionMatchesCurrentDraft()) {
      clearSuggestion()
      setSuggestionError(
        'The draft changed. Request a new suggestion before replacing it.',
      )
      return
    }
    setIsUseDialogOpen(true)
  }

  const adoptSuggestion = async () => {
    if (!suggestion || !suggestionMatchesCurrentDraft()) {
      clearSuggestion()
      setSuggestionError(
        'The draft changed. Request a new suggestion before replacing it.',
      )
      return
    }
    setIsAdopting(true)
    setSuggestionError(null)
    try {
      await onSaveDraft(suggestion.text, suggestion.provenanceToken)
      textRevision.current += 1
      setText(suggestion.text)
      clearSuggestion()
    } catch {
      setSuggestionError(
        'The suggestion could not be used. Review the current draft and try again.',
      )
    } finally {
      setIsAdopting(false)
    }
  }

  const updateText = (nextText: string) => {
    textRevision.current += 1
    setText(nextText)
    if (suggestion && nextText !== suggestion.text) clearSuggestion()
  }

  return {
    text,
    tone,
    setTone,
    suggestion,
    isGenerating,
    isAdopting,
    suggestionError,
    isUseDialogOpen,
    setIsUseDialogOpen,
    clearSuggestion,
    requestSuggestion,
    openUseDialog,
    adoptSuggestion,
    updateText,
  }
}
