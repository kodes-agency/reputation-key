import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import type { ReplyLanguageTarget } from './reply-language-options'
import type { LoadedReplyTemplateDraft } from './reply-suggestion-contract'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import type { ReplyAssistScope } from './use-reply-suggestion'

/**
 * Which library template the composer's current draft was loaded from — the
 * data behind row 18's `Template · <title> · Bulgarian`.
 *
 * `LoadedReplyTemplateDraft` (the load command's result,
 * `reply-suggestion-contract.ts`) carries `templateId` and `templateVersion`
 * and no title; the only titles the client holds are the list's
 * (`ReplyTemplateListItem`, `{ id, title, … }`). So the title is resolved by
 * looking the verified id up in that list — see `templateTitleIn`.
 */
export type LoadedReplyTemplate = Readonly<{
  templateId: string
  /** `null` when the id is not in the list the load was made from. */
  title: string | null
}>

/**
 * The title of `templateId` in a fetched library, or `null` when it is absent.
 *
 * Resolved ONCE, at load time, against the library for the target the load
 * ran in — not at render time against `templates` below. That list is scoped to
 * the CURRENT target (`library` requires `libraryState.targetKind ===
 * target.kind`), and row 17 puts a language switch at the top of the very menu
 * that loaded the template: switching it without loading anything empties the
 * list for the new language, and a render-time lookup would drop the title
 * from a tag whose text had not changed. The id is never trusted from the
 * caller's arguments: `load` only records an id the server echoed back
 * (`reply.templateId !== templateId` is refused below).
 */
export function templateTitleIn(
  library: ReplyTemplateListResult | null,
  templateId: string,
): string | null {
  if (library === null) return null
  const match = library.groups
    .flatMap((group) => group.templates)
    .find((template) => template.id === templateId)
  return match?.title ?? null
}

type Input = Readonly<{
  target: ReplyLanguageTarget | null
  revision: React.RefObject<number>
  onList?: (target: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  onLoad?: (
    templateId: string,
    target: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
  onAccept: (draft: ReplyDraftSnapshot) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot, template: LoadedReplyTemplate) => void
  onLoadLocalSafe: () => Promise<void>
  onDismissSuggestion: () => void
}>

type Tagged<T> = Readonly<{
  targetKind: ReplyLanguageTarget['kind']
  value: T
}>

type TargetKind = ReplyLanguageTarget['kind']

/**
 * The bookkeeping of the one request this hook treats as live: a sequence that
 * supersedes every older request, and the target kind the live one was made
 * for (`null` once it settled, or before any started).
 *
 * Pure and exported because `isLoading` hangs on it, and the unit project has
 * no renderer. The hook clears `isLoading` in exactly two places — the
 * `finally` of the live request, and a target change that DISCARDS one — so a
 * request that stops being live any other way leaves `isLoading` true for
 * good. That is not a menu row reading `Loading…`: `busy` in
 * `reply-editor-compose.tsx` disables the textarea, Submit, Undo, `Delete
 * draft` and all three assist triggers, and nothing re-enables them until the
 * manager leaves the item.
 */
export type TemplateRequestLedger = Readonly<{
  sequence: number
  liveKind: TargetKind | null
}>

export const INITIAL_TEMPLATE_REQUESTS: TemplateRequestLedger = {
  sequence: 0,
  liveKind: null,
}

/** A new request, superseding whatever was live. Its token is `.sequence`. */
export function startTemplateRequest(
  ledger: TemplateRequestLedger,
  kind: TargetKind,
): TemplateRequestLedger {
  return { sequence: ledger.sequence + 1, liveKind: kind }
}

export function isLiveTemplateRequest(
  ledger: TemplateRequestLedger,
  sequence: number,
): boolean {
  return sequence === ledger.sequence
}

/** The live request returned; a superseded one changes nothing. */
export function settleTemplateRequest(
  ledger: TemplateRequestLedger,
  sequence: number,
): TemplateRequestLedger {
  return isLiveTemplateRequest(ledger, sequence) ? { ...ledger, liveKind: null } : ledger
}

/**
 * The target moved. A live request made for a DIFFERENT target is discarded
 * (its list or draft belongs to a language the writer just left) and reported,
 * so the hook clears `isLoading` for it — its own `finally` no longer can. A
 * request for the target just moved TO is kept: row 17's switch asks for the
 * new language's list in the same event that moves the target
 * (`prepareMenu(scope)`), before the effect that calls this runs.
 *
 * The case this was written for is A → B → A inside the template menu:
 * `Detect automatically` starts the review-language fetch, a tap back on the
 * property default is answered from the cache WITHOUT starting a request, and
 * the target moves back while the review fetch is still out. Discarding it
 * without saying so is what froze the composer.
 */
export function retargetTemplateRequests(
  ledger: TemplateRequestLedger,
  targetKind: TargetKind | null,
): Readonly<{ ledger: TemplateRequestLedger; discarded: boolean }> {
  if (ledger.liveKind === null || ledger.liveKind === targetKind) {
    return { ledger, discarded: false }
  }
  return { ledger: { sequence: ledger.sequence + 1, liveKind: null }, discarded: true }
}

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
  const requests = useRef<TemplateRequestLedger>(INITIAL_TEMPLATE_REQUESTS)
  const targetKind = target?.kind ?? null

  // A target change discards a request made for a DIFFERENT target, and clears
  // `isLoading` when it does — see `retargetTemplateRequests` for the A → B → A
  // sequence that used to leave the whole composer disabled.
  useEffect(() => {
    const moved = retargetTemplateRequests(requests.current, targetKind)
    requests.current = moved.ledger
    if (moved.discarded) setIsLoading(false)
  }, [targetKind])

  useEffect(
    () => () => {
      requests.current = { sequence: requests.current.sequence + 1, liveKind: null }
    },
    [],
  )

  // Ref-only helpers, so they are stable and every callback below can list them.
  const begin = useCallback((kind: TargetKind): number => {
    requests.current = startTemplateRequest(requests.current, kind)
    return requests.current.sequence
  }, [])
  const isLive = useCallback(
    (requestSequence: number) => isLiveTemplateRequest(requests.current, requestSequence),
    [],
  )
  const settle = useCallback((requestSequence: number) => {
    if (!isLiveTemplateRequest(requests.current, requestSequence)) return
    requests.current = settleTemplateRequest(requests.current, requestSequence)
    setIsLoading(false)
  }, [])

  const ensureLibrary = useCallback(
    async (
      requested: ReplyLanguageTarget | null = target,
    ): Promise<ReplyTemplateListResult | null> => {
      if (!requested || !onList) return null
      if (cache.current?.targetKind === requested.kind) return cache.current.value
      const requestSequence = begin(requested.kind)
      setIsLoading(true)
      setErrorState(null)
      try {
        const value = await onList(requested)
        if (!isLive(requestSequence)) return null
        const tagged = { targetKind: requested.kind, value }
        cache.current = tagged
        setLibraryState(tagged)
        return value
      } catch {
        if (isLive(requestSequence)) {
          setErrorState({
            targetKind: requested.kind,
            value: 'Templates could not be loaded. Try again.',
          })
        }
        return null
      } finally {
        settle(requestSequence)
      }
    },
    [begin, isLive, onList, settle, target],
  )

  const load = useCallback(
    async (templateId: string, title: string) => {
      if (!target || !onLoad || isLoading) return
      const requestSequence = begin(target.kind)
      const baseRevision = revision.current
      setIsLoading(true)
      setErrorState(null)
      setLoadedState(null)
      onDismissSuggestion()
      try {
        const reply = await onLoad(templateId, target)
        if (!isLive(requestSequence) || baseRevision !== revision.current) return
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
        const library =
          cache.current?.targetKind === target.kind ? cache.current.value : null
        await onAccept(nextDraft)
        onAdopt(nextDraft, { templateId, title: templateTitleIn(library, templateId) })
        setLoadedState({
          targetKind: target.kind,
          value: `Template loaded: ${title}`,
        })
      } catch {
        if (isLive(requestSequence)) {
          setErrorState({
            targetKind: target.kind,
            value: 'The template could not be loaded. Try again.',
          })
        }
      } finally {
        settle(requestSequence)
      }
    },
    [
      begin,
      isLive,
      isLoading,
      onAccept,
      onAdopt,
      onDismissSuggestion,
      onLoad,
      revision,
      settle,
      target,
    ],
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
    /** Fetches the list the template menu shows. Pass the scope
     *  `updateLanguage` returned when the menu's language switch changed the
     *  target in this same event; see `ReplyAssistScope` for why. */
    prepareMenu: (scope?: Pick<ReplyAssistScope, 'target'>) => {
      void ensureLibrary(scope ? scope.target : target)
    },
    loadRecommended,
    load,
    loadLocalSafe,
  }
}
