import { useSearch } from '@tanstack/react-router'
import type {
  ReviewAspect,
  ReviewAspectPolarity,
} from '#/contexts/inbox/application/public-api'
import { inboxSearchObjectSchema } from './inbox-search-schema'

/** The topic (and, when the link named one, the polarity) the Inbox was opened on. */
export type MatchedTopic = Readonly<{
  aspect: ReviewAspect
  polarity: ReviewAspectPolarity | undefined
}>

const matchedTopicSchema = inboxSearchObjectSchema.pick({ aspect: true, polarity: true })

/**
 * The topic an address names. Anything the Inbox cannot read (an old topic, a
 * hand-edited value) is no topic, as it is for the list.
 */
export function matchedTopicOf(search: unknown): MatchedTopic | null {
  const parsed = matchedTopicSchema.safeParse(search ?? {})
  if (!parsed.success || parsed.data.aspect === undefined) return null
  return { aspect: parsed.data.aspect, polarity: parsed.data.polarity }
}

/**
 * The topic filter in the address, read from where it is written. A Guest voice
 * link opens the Inbox on `?aspect=room&polarity=negative`; the open review is
 * then told which of its chips is the one the person followed. Absent when the
 * Inbox was not opened on a topic. Read here, not threaded: the review's chips
 * are five components below the page that owns the address.
 */
export function useMatchedTopic(): MatchedTopic | null {
  return matchedTopicOf(useSearch({ strict: false }))
}
