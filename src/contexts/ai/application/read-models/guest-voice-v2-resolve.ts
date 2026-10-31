// Finding the guests' words for a draft of the page. The AI context holds no review text
// and opens no Inbox item, so the two answers it needs come from outside, through two
// readers the delivery layer supplies: which Inbox Item opens each review for this
// reader, and what each review says now. A review the reader cannot open is not quoted,
// whatever the analysis says of it.
import { type GuestVoiceV2Draft, type ResolvedReview } from './guest-voice-v2-evidence'

/** Review ids one lookup may ask about; the Inbox answers at most this many at once. */
const RESOLVE_LIMIT = 100

export type DraftReviewReaders = Readonly<{
  /** The Inbox Items that open these reviews for the reader. A review not in it cannot be opened. */
  inboxItemIds(reviewIds: readonly string[]): Promise<ReadonlyMap<string, string>>
  /**
   * What these reviews say now, and the Review revision those words are; absent or a
   * null text where the words are not servable.
   */
  reviewTexts(
    reviewIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReviewWords | null>>
}>

/** A review's words as Review serves them now, with the revision they are. */
export type ReviewWords = Readonly<{ text: string | null; sourceRevision: number }>

/** The reviews a draft wants to quote or list, and the ones whose words it will print. */
function wantedReviews(draft: Pick<GuestVoiceV2Draft, 'evidence' | 'latest'>): Readonly<{
  all: readonly string[]
  withText: readonly string[]
}> {
  const withText = new Set<string>()
  const all = new Set<string>()
  for (const slot of draft.evidence) {
    for (const candidate of slot.candidates) {
      all.add(candidate.reviewId)
      withText.add(candidate.reviewId)
    }
  }
  for (const review of draft.latest) {
    all.add(review.reviewId)
    if (review.mayShowText) withText.add(review.reviewId)
  }
  return { all: [...all].slice(0, RESOLVE_LIMIT), withText: [...withText] }
}

export async function resolveDraftReviews(
  draft: Pick<GuestVoiceV2Draft, 'evidence' | 'latest'>,
  readers: DraftReviewReaders,
): Promise<ReadonlyMap<string, ResolvedReview>> {
  const wanted = wantedReviews(draft)
  if (wanted.all.length === 0) return new Map()
  const items = await readers.inboxItemIds(wanted.all)
  const openable = wanted.withText.filter(
    (reviewId) => wanted.all.includes(reviewId) && items.has(reviewId),
  )
  const texts =
    openable.length === 0
      ? new Map<string, ReviewWords | null>()
      : await readers.reviewTexts(openable)
  const resolved = new Map<string, ResolvedReview>()
  for (const reviewId of wanted.all) {
    const inboxItemId = items.get(reviewId)
    if (inboxItemId === undefined) continue
    const words = texts.get(reviewId)
    resolved.set(reviewId, {
      inboxItemId,
      text: words?.text ?? null,
      sourceRevision: words?.sourceRevision ?? null,
    })
  }
  return resolved
}
