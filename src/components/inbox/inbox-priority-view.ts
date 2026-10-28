// The words of the case toolbar's Priority control (ADR 0071, plan §3.1 and the
// copy deck C-1 to C-7). Pure: no React, so the node unit project tests every
// sentence the control can print.
//
// Two levels meet here. The SET level is a person's choice and arrives on the
// item (`managerPriority`, who and when). The SUGGESTION is the AI's current
// attention for a review, read from the detail's analysis; it is shown, tagged
// "Suggested", only while nobody has set a level. Manager copy never says "AI":
// the product calls it review signals.
import {
  effectiveInboxPriority,
  type InboxItem,
  type InboxPriority,
  type InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { formatCompactAge } from './utils'

/** C-1: each level's word, as the trigger, the menu and the list print it. */
export const PRIORITY_WORD: Readonly<Record<InboxPriority, string>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/**
 * The AI suggestion the pane may show. Only a ready analysis carries one; a
 * disabled, unavailable or absent analysis is no suggestion, so the item reads
 * "Not set" rather than a made-up level (AI invariant 8).
 */
export function prioritySuggestion(
  analysis: InboxReviewAnalysis | null | undefined,
): InboxPriority | null {
  return analysis?.status === 'ready' ? analysis.attention : null
}

export type InboxPriorityView = Readonly<{
  /** The level shown — set, else suggested — or null for "Not set". */
  level: InboxPriority | null
  isSuggested: boolean
  /** The level a person set: the menu's check mark and the command's expectation. */
  setLevel: InboxPriority | null
  suggestion: InboxPriority | null
  /** C-1 or C-2: the trigger's word. */
  word: string
  /** C-4: the trigger's accessible name. */
  accessibleName: string
  /** C-6: who set it and how long ago, or where the level comes from. */
  sourceLine: string
  /** C-7: the reset item, offered only while a level is set. */
  resetLabel: string | null
  /**
   * In a narrow toolbar — a phone, or the detail pane at its desktop floor —
   * Urgent and High keep their word and the rest become glyph squares.
   */
  keepsWordWhenNarrow: boolean
}>

type PriorityOwner = Pick<
  InboxItem,
  'managerPriority' | 'managerPrioritySetBy' | 'managerPrioritySetAt'
>

/** The viewer, as `InboxCurrentUser` carries it; only the id is read here. */
type Viewer = Readonly<{ id: string }>

/**
 * Who set the level, in the owner control's terms (`resolveInboxOwner`): the
 * viewer is "you", a listed member is their name, and anyone the toolbar's
 * options do not hold (offboarded, or an AccountAdmin missing from them) is
 * "a manager". A raw user id is never printed.
 */
function setterName(
  setBy: string,
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>,
  currentUser: Viewer | undefined,
): string {
  if (currentUser !== undefined && setBy === currentUser.id) return 'you'
  const listed = assignmentOptions.find((option) => option.userId === setBy)?.name.trim()
  return listed || 'a manager'
}

function sourceLineFor(
  item: PriorityOwner,
  isSuggested: boolean,
  input: Readonly<{
    assignmentOptions: ReadonlyArray<InboxAssignmentOption>
    currentUser?: Viewer
    now?: Date
  }>,
): string {
  const setBy = item.managerPrioritySetBy
  if (item.managerPriority && setBy) {
    const who = setterName(setBy, input.assignmentOptions, input.currentUser)
    const at = item.managerPrioritySetAt
    return at ? `Set by ${who} · ${formatCompactAge(at, input.now)}` : `Set by ${who}`
  }
  return isSuggested ? 'Suggested from review signals' : 'Not set'
}

export function presentInboxPriority(
  input: Readonly<{
    item: PriorityOwner
    suggestion: InboxPriority | null
    assignmentOptions: ReadonlyArray<InboxAssignmentOption>
    currentUser?: Viewer
    now?: Date
  }>,
): InboxPriorityView {
  const setLevel = input.item.managerPriority ?? null
  const effective = effectiveInboxPriority(setLevel, input.suggestion)
  const level = effective?.level ?? null
  const isSuggested = effective?.source === 'suggested'
  const word = level === null ? 'Priority' : PRIORITY_WORD[level]
  return {
    level,
    isSuggested,
    setLevel,
    suggestion: input.suggestion,
    word,
    accessibleName:
      level === null
        ? 'Priority: not set'
        : `Priority: ${word}${isSuggested ? ', suggested' : ''}`,
    sourceLine: sourceLineFor(input.item, isSuggested, input),
    resetLabel:
      setLevel === null
        ? null
        : input.suggestion === null
          ? 'Remove priority'
          : `Back to suggestion (${PRIORITY_WORD[input.suggestion]})`,
    keepsWordWhenNarrow: level === 'urgent' || level === 'high',
  }
}

/**
 * C-10: the quiet line under the review's topics, shown only when a person's
 * level and the current suggestion disagree. While the item follows the
 * suggestion the toolbar already says it, so there is no line.
 */
export function prioritySuggestionHint(
  setLevel: InboxPriority | null | undefined,
  suggestion: InboxPriority | null,
): string | null {
  if (!setLevel || suggestion === null || suggestion === setLevel) return null
  return `Review signals suggest ${PRIORITY_WORD[suggestion]}.`
}
