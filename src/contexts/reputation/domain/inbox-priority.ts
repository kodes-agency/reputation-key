// Inbox context — manager priority (ADR 0071).
//
// Two values meet here and must never be confused. The SET level is what a
// person chose; Inbox stores it (`inbox_items.manager_priority`). The
// SUGGESTION is the AI context's current attention level for a review, read
// live through the AI port and never stored by Inbox. The level a manager sees
// — the list's cue, the toolbar, the Priority filter — is the set level when
// there is one, otherwise the suggestion, otherwise none ("Not set").
//
// Pure: no clock, no I/O.

/** The four levels, most pressing first. Also the order the menu lists them. */
export const INBOX_PRIORITY_LEVELS = ['urgent', 'high', 'medium', 'low'] as const

export type InboxPriority = (typeof INBOX_PRIORITY_LEVELS)[number]

/** Where the level a manager sees comes from. */
export type InboxPrioritySource = 'set' | 'suggested'

export type EffectiveInboxPriority = Readonly<{
  level: InboxPriority
  source: InboxPrioritySource
}>

/**
 * The level in force: a person's choice wins, and an AI suggestion never
 * overwrites it (AI invariant 5). Missing data is "no level", never a made-up
 * Low or Medium (AI invariant 8).
 */
export function effectiveInboxPriority(
  managerPriority: InboxPriority | null | undefined,
  suggestion: InboxPriority | null | undefined,
): EffectiveInboxPriority | null {
  if (managerPriority) return { level: managerPriority, source: 'set' }
  if (suggestion) return { level: suggestion, source: 'suggested' }
  return null
}
