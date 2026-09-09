import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import type { ReplyLanguageTarget } from './reply-language-options'
import type { LoadedReplyTemplateDraft } from './reply-suggestion-contract'
import type { ReplyDraftSnapshot } from './use-reply-autosave'

type Input = Readonly<{
  target: ReplyLanguageTarget | null
  revision: React.RefObject<number>
  onList?: (target: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  onLoad?: (
    templateId: string,
    target: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
  onAccept: (draft: ReplyDraftSnapshot) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot) => void
  onLoadLocalSafe: () => Promise<void>
  onDismissSuggestion: () => void
}>

type Tagged<T> = Readonly<{
  targetKind: ReplyLanguageTarget['kind']
  value: T
}>

export function useReplyTemplate(input: Input) {
  const {
    target,
    revision,
    onList,
    onLoad,
    onAccept,
    onAdopt,
    onLoadLocalSafe,
    onDismissSuggestion,
  } = input
  const [libraryState, setLibraryState] =
    useState<Tagged<ReplyTemplateListResult> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorState, setErrorState] = useState<Tagged<string> | null>(null)
  const [loadedState, setLoadedState] = useState<Tagged<string> | null>(null)
  const cache = useRef<Tagged<ReplyTemplateListResult> | null>(null)
  const sequence = useRef(0)
  const targetKind = target?.kind ?? null

  useEffect(() => {
    sequence.current += 1
  }, [targetKind])

  useEffect(
    () => () => {
      sequence.current += 1
    },
    [],
  )

  const ensureLibrary = useCallback(async (): Promise<ReplyTemplateListResult | null> => {
    if (!target || !onList) return null
    if (cache.current?.targetKind === target.kind) return cache.current.value
    const requestSequence = ++sequence.current
    setIsLoading(true)
    setErrorState(null)
    try {
      const value = await onList(target)
      if (requestSequence !== sequence.current) return null
      const tagged = { targetKind: target.kind, value }
      cache.current = tagged
      setLibraryState(tagged)
      return value
    } catch {
      if (requestSequence === sequence.current) {
        setErrorState({
          targetKind: target.kind,
          value: 'Templates could not be loaded. Try again.',
        })
      }
      return null
    } finally {
      if (requestSequence === sequence.current) setIsLoading(false)
    }
  }, [onList, target])

  const load = useCallback(
    async (templateId: string, title: string) => {
      if (!target || !onLoad || isLoading) return
      const requestSequence = ++sequence.current
      const baseRevision = revision.current
      setIsLoading(true)
      setErrorState(null)
      setLoadedState(null)
      onDismissSuggestion()
      try {
        const reply = await onLoad(templateId, target)
        if (requestSequence !== sequence.current || baseRevision !== revision.current) {
          return
        }
        if (
          !reply.text.trim() ||
          reply.text.length > MAX_REPLY_LENGTH ||
          !reply.replyLanguageTag ||
          reply.templateId !== templateId ||
          reply.templateVersion === null
        ) {
          setErrorState({
            targetKind: target.kind,
            value: 'The loaded template could not be verified.',
          })
          return
        }
        const nextDraft = { text: reply.text, languageTag: reply.replyLanguageTag }
        await onAccept(nextDraft)
        onAdopt(nextDraft)
        setLoadedState({
          targetKind: target.kind,
          value: `Template loaded: ${title}`,
        })
      } catch {
        if (requestSequence === sequence.current) {
          setErrorState({
            targetKind: target.kind,
            value: 'The template could not be loaded. Try again.',
          })
        }
      } finally {
        if (requestSequence === sequence.current) setIsLoading(false)
      }
    },
    [isLoading, onAccept, onAdopt, onDismissSuggestion, onLoad, revision, target],
  )

  const loadRecommended = useCallback(async () => {
    const value = await ensureLibrary()
    if (value === null || target === null) return
    const recommended = value.groups
      .flatMap((group) => group.templates)
      .find((template) => template.id === value.recommendedTemplateId)
    if (recommended) {
      await load(recommended.id, recommended.title)
      return
    }
    setLoadedState(null)
    await onLoadLocalSafe()
  }, [ensureLibrary, load, onLoadLocalSafe, target])

  const loadLocalSafe = useCallback(async () => {
    if (target === null) return
    setLoadedState(null)
    setErrorState(null)
    await onLoadLocalSafe()
  }, [onLoadLocalSafe, target])

  const library =
    target !== null && libraryState?.targetKind === target.kind
      ? libraryState.value
      : null
  const error =
    target !== null && errorState?.targetKind === target.kind ? errorState.value : null
  const loadedMessage =
    target !== null && loadedState?.targetKind === target.kind ? loadedState.value : null

  return {
    library,
    templates: library?.groups.flatMap((group) => group.templates) ?? [],
    isLoading,
    error,
    loadedMessage,
    clearLoadedMessage: () => setLoadedState(null),
    prepareMenu: () => {
      void ensureLibrary()
    },
    loadRecommended,
    load,
    loadLocalSafe,
  }
}
