import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  createReplyDraftSession,
  scheduleBackgroundDraft,
  draftReviewTextDigest,
  type ReplyDraftSession,
} from './reply-draft-session'
import type { DraftStream } from './reply-draft-stream'
import { streamReplyDraft } from './use-reply-actions'
import { REPLY_DRAFTING_V2_SERVED_LANGUAGES } from '#/shared/reply-drafting-v2-schema'
import { mapReplyLanguageMetadata } from '#/shared/reply-language-catalogue'

type DraftingDetail = Readonly<{
  item: Readonly<{ id: string }>
  replyDraftingAvailable?: boolean
  reply: object | null
  reviewText?: string | null
  reviewRating?: number | null
  propertyDefaultReplyLanguage?: string | null
  reviewReplyLanguage?: string | null
  replyBodyFrame?: Readonly<{ prefix: string; suffix: string }> | null
}>
const draftingLanguages = new Set<string>(REPLY_DRAFTING_V2_SERVED_LANGUAGES)
const idleSession = createReplyDraftSession('', async () => {})
const DraftSessionContext = createContext<Readonly<{
  session: ReplyDraftSession
  original: string
  originalDigest: string | null
}> | null>(null)
export const useReplyDraftSession = () => useContext(DraftSessionContext)
export function useDraftSessionSnapshot(session: ReplyDraftSession | undefined) {
  const store = session ?? idleSession
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
export { BACKGROUND_DRAFT_DWELL_MILLIS } from './reply-draft-session'

export function backgroundDraftTarget(detail: DraftingDetail | null) {
  if (!detail?.replyDraftingAvailable || detail.reply || !detail.reviewText?.trim())
    return null
  const language = detail.propertyDefaultReplyLanguage ?? detail.reviewReplyLanguage
  const mapped = mapReplyLanguageMetadata(language)
  if (
    mapped.status !== 'supported' ||
    !mapped.language ||
    !draftingLanguages.has(mapped.language.templateGroup)
  )
    return null
  return {
    kind: detail.propertyDefaultReplyLanguage
      ? ('property_default' as const)
      : ('review_language' as const),
  }
}

/** Above the conditional editor: background work stays silent until Draft with AI. */
export function ReplyDraftSessionProvider({
  item,
  detail,
  children,
  stream = streamReplyDraft,
}: Readonly<{
  item: Readonly<{
    id: string
    sourceType: 'review' | 'feedback'
    sourceId: string
    reviewerName?: string | null
  }>
  detail: DraftingDetail | null
  children: ReactNode
  stream?: DraftStream
}>) {
  const currentDetail = detail?.item.id === item.id ? detail : null
  const original = currentDetail?.reviewText ?? ''
  const [digest, setDigest] = useState<Readonly<{ text: string; value: string }> | null>(
    null,
  )
  useEffect(() => {
    let current = true
    void draftReviewTextDigest(original).then((value) => {
      if (current) setDigest({ text: original, value })
    })
    return () => {
      current = false
    }
  }, [original])
  const sourceIdentity = `${item.id}:${item.reviewerName ?? ''}:${currentDetail?.reviewRating ?? ''}:${original}`
  const session = useMemo(
    () => createReplyDraftSession(item.sourceId, stream, sourceIdentity),
    [item.sourceId, sourceIdentity, stream],
  )
  useEffect(() => {
    session.seedFrame(currentDetail?.replyBodyFrame ?? null)
  }, [session, currentDetail?.replyBodyFrame])
  const draftingAvailable = currentDetail?.replyDraftingAvailable
  useEffect(() => {
    if (draftingAvailable === false) session.dismiss()
  }, [session, draftingAvailable])
  const target =
    item.sourceType === 'review' ? backgroundDraftTarget(currentDetail) : null
  const kind = target?.kind
  useEffect(() => {
    if (!kind) return
    return scheduleBackgroundDraft(session, { kind })
  }, [kind, session])
  useEffect(() => () => session.dispose(), [session])
  return (
    <DraftSessionContext.Provider
      value={{
        session,
        original,
        originalDigest: digest?.text === original ? digest.value : null,
      }}
    >
      {children}
    </DraftSessionContext.Provider>
  )
}
