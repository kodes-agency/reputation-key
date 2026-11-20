// Shared generated revision reasons distinguish command changes from manager
// notes, so generated text is never presented as a quotation. Browser-safe.

/** A version's reason when no note was given, by the command that writes it. */
export const GOAL_VERSION_REASONS = {
  /** The first version of a goal. */
  created: 'created',
  /** A new number or measure from a coming month. */
  revised: 'revised',
  /** New subjects from a coming month. */
  subjectsChanged: 'subjects_changed',
  /** The version a month's own number wrote for the months after it. */
  targetChanged: 'target_changed',
} as const

/**
 * A version's reason as the manager's note; null when it is the kind of change.
 * Worked out when asked, so the module does nothing when it loads and a bundle
 * that only imports it drops it.
 */
export const versionNoteOf = (reason: string): string | null =>
  (Object.values(GOAL_VERSION_REASONS) as readonly string[]).includes(reason)
    ? null
    : reason
