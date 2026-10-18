// Reporting — what a Goal Program version records as its reason when the
// manager left no note: the kind of change the command made. One list, for the
// commands that write a version and the reads that tell a manager's note from
// the kind of change, so a new kind can never show as a quoted note. Pure and
// client-safe.

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

const KINDS: ReadonlySet<string> = new Set(Object.values(GOAL_VERSION_REASONS))

/** A version's reason as the manager's note; null when it is the kind of change. */
export const versionNoteOf = (reason: string): string | null =>
  KINDS.has(reason) ? null : reason
