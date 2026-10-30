import { useSearch } from '@tanstack/react-router'
import type { ReviewAspectPolarity } from '#/contexts/inbox/application/public-api'
import { inboxSearchObjectSchema } from './inbox-search-schema'

/** The Property issue (and, when the link named one, the polarity) the Inbox was opened on. */
export type MatchedIssue = Readonly<{
  issueId: string
  polarity: ReviewAspectPolarity | undefined
}>

const matchedIssueSchema = inboxSearchObjectSchema.pick({ issue: true, polarity: true })

/**
 * The issue an address names. Anything the Inbox cannot read (a value that is not an
 * id, a hand-edited address) is no issue, as it is for the list.
 */
export function matchedIssueOf(search: unknown): MatchedIssue | null {
  const parsed = matchedIssueSchema.safeParse(search ?? {})
  if (!parsed.success || parsed.data.issue === undefined) return null
  return { issueId: parsed.data.issue, polarity: parsed.data.polarity }
}

/**
 * The issue filter in the address, read from where it is written. A Guest voice link
 * opens the Inbox on `?issue=<id>&polarity=negative`; the open review is then told
 * which of its chips are the ones the person followed. Read here, not threaded, for the
 * reason `useMatchedTopic` is: the chips are five components below the page that owns
 * the address.
 */
export function useMatchedIssue(): MatchedIssue | null {
  return matchedIssueOf(useSearch({ strict: false }))
}
