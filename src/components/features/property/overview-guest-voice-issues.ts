// What Overview's Guest voice row names, from the same read the Guest voice page draws
// (the v3 analysis): the problem to fix first and the thing guests love most, and how it
// counts them. A count is a count of reviews with text: "Cleanliness, 9 of 128 reviews".
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'

/** The window the row reads: the automatic one, as the page opens on. */
export const OVERVIEW_GUEST_VOICE_RANGE: GuestVoiceRange = 'auto'

export type OverviewGuestVoiceReady = Extract<GuestVoiceV2Read, { status: 'ready' }>

export type OverviewIssue = Readonly<{
  issueId: string
  title: string
  statistics: Readonly<{ shareText: string; textReviewCount: number }>
}>

/** "Cleanliness, 9 of 128 reviews". */
export function overviewIssueCountText(issue: OverviewIssue): string {
  const reviews = issue.statistics.textReviewCount === 1 ? 'review' : 'reviews'
  return `${issue.title}, ${issue.statistics.shareText} ${reviews}`
}

/**
 * The complaint the row names is the first thing the page puts under "Urgent", else the
 * first of "Fix first"; the praise is the first of "Guests love". Either is null where the
 * page has none. The sentence is the page's own first "In short" line.
 */
export function overviewTopIssues(read: OverviewGuestVoiceReady): Readonly<{
  complaint: OverviewIssue | null
  praise: OverviewIssue | null
  sentence: string | null
}> {
  return {
    complaint: read.urgent[0] ?? read.fixFirst[0] ?? null,
    praise: read.guestsLove[0] ?? null,
    sentence: read.inShort[0]?.text ?? null,
  }
}
