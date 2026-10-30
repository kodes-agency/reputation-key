import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import type { GuestVoiceIssueGroup, GuestVoiceMention } from './guest-voice-v2-facts'
import type { IssueTally } from './guest-voice-v2-tally'
import { causeCounts } from './guest-voice-v2-causes'

export function issueDisplayTitle(
  group: GuestVoiceIssueGroup,
  tally: IssueTally,
): string {
  if (group.displayName?.trim()) return group.displayName
  const thing = group.canonicalThing
  const name = thing
    ? thing.charAt(0).toUpperCase() + thing.slice(1)
    : REVIEW_TOPIC_LABELS_V3[group.topic]
  const cause = causeCounts(tally).at(0)?.cause
  return cause ? `${name} — ${cause}` : name
}

/** Answers use fixed area phrases in the UI words module; never joined issue labels. */
export function issueAnswerName(group: GuestVoiceIssueGroup, _tally: IssueTally): string {
  return REVIEW_TOPIC_LABELS_V3[group.topic]
}

/** Manager names stay verbatim. Automatic duplicates get topic, then stable id context. */
export function issueTitles(
  tallies: readonly IssueTally[],
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>,
): ReadonlyMap<string, string> {
  const entries = tallies.flatMap((tally) => {
    const group = groups.get(tally.groupId)
    return group ? [{ tally, group, title: issueDisplayTitle(group, tally) }] : []
  })
  const duplicates = new Map<string, number>()
  for (const e of entries) duplicates.set(e.title, (duplicates.get(e.title) ?? 0) + 1)
  const titled = entries.map((e) => ({
    ...e,
    title:
      !e.group.displayName?.trim() && (duplicates.get(e.title) ?? 0) > 1
        ? `${e.title} (${REVIEW_TOPIC_LABELS_V3[e.group.topic]})`
        : e.title,
  }))
  const counts = new Map<string, number>()
  for (const e of titled) counts.set(e.title, (counts.get(e.title) ?? 0) + 1)
  const suffixCounts = new Map<string, number>()
  for (const e of titled) {
    const key = `${e.title}:${e.group.id.replaceAll('-', '').slice(-8)}`
    suffixCounts.set(key, (suffixCounts.get(key) ?? 0) + 1)
  }
  return new Map(
    titled.map((e) => [
      e.group.id,
      !e.group.displayName?.trim() && (counts.get(e.title) ?? 0) > 1
        ? `${e.title} · ${(suffixCounts.get(`${e.title}:${e.group.id.replaceAll('-', '').slice(-8)}`) ?? 0) > 1 ? e.group.id : e.group.id.replaceAll('-', '').slice(-8)}`
        : e.title,
    ]),
  )
}

/** An effective cause row can name the thing even before issue grouping is available. */
export function mentionCauseTitle(
  mention: GuestVoiceMention,
  group: GuestVoiceIssueGroup | undefined,
): string {
  if (group?.displayName?.trim()) return group.displayName
  const thing = group?.canonicalThing ?? mention.thing
  const name = thing
    ? thing.charAt(0).toUpperCase() + thing.slice(1)
    : REVIEW_TOPIC_LABELS_V3[mention.topic]
  const cause = mention.cause?.trim().toLowerCase()
  return cause ? `${name} — ${cause}` : name
}
