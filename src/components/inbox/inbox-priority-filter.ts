// The Priority filter's one combined choice (owner P-3, 2026-10-28): "Urgent
// and High", `attention=urgent_high` in the address. The server already takes
// several levels, so the combined choice is only a URL word; it becomes the two
// levels here, in the list's request, and nowhere in route configuration (the
// search schema spells the literal itself, because it is in first paint).
//
// The filter matches the EFFECTIVE level — a person's, else the suggestion — on
// Reviews and private feedback alike (ADR 0071), so it is offered in every
// queue.
import type { InboxPriority } from '#/contexts/inbox/application/public-api'

export type InboxPriorityFilterValue = InboxPriority | 'urgent_high'

/** The levels the list asks the server for. */
export function priorityFilterLevels(
  value: InboxPriorityFilterValue | undefined,
): InboxPriority | InboxPriority[] | undefined {
  return value === 'urgent_high' ? ['urgent', 'high'] : value
}
