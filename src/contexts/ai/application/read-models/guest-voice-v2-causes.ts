import { senseOf } from './guest-voice-v2-facts'
import type { IssueTally } from './guest-voice-v2-tally'

/** Each normalized cause once per review, shared by titles, cards and details. */
export function causeCounts(
  tally: IssueTally,
): readonly Readonly<{ cause: string; reviewCount: number }>[] {
  const counts = new Map<string, number>()
  for (const review of tally.reviews) {
    const causes = new Set(
      review.mentions
        .filter(
          (m) => m.issueGroupId === tally.groupId && senseOf(m.polarity) === tally.sense,
        )
        .flatMap((m) => (m.cause?.trim() ? [m.cause.trim().toLowerCase()] : [])),
    )
    for (const cause of causes) counts.set(cause, (counts.get(cause) ?? 0) + 1)
  }
  return [...counts]
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([cause, reviewCount]) => ({ cause, reviewCount }))
}
