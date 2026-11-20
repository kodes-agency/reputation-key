import { Flag } from 'lucide-react'
import type { ComponentType } from 'react'
import { TONE_ICON, TONE_INK } from '#/components/ui/tone'
import { HighPriorityGlyph } from './inbox-priority-glyph'
import type { InboxRowSignal } from './inbox-list-row-view'

// An urgent review stands out in the list (owner decision, 2026-10-17): users
// opening Needs reply missed rows whose only cue was a bold "Urgent" in the
// page ink. The row now wears a light red tint, and the label prints in the
// negative tone with that tone's one icon. Escalated shares the red but keeps
// its Flag, so the two are told apart by their glyphs as well as their words.
//
// The tint is the negative tone's own fill (`--destructive-muted`) at 80% over
// the page. At full strength the 1px edge of the shared focus ring read 2.98:1
// on it in the dark theme, under the 3:1 a focus indicator needs; at 80% it
// reads 3.1:1 dark and 3.9:1 light, and every ink the row prints holds 4.5:1
// on it. `inbox-list-row-tone.test.ts` measures each pair in both themes.
export const URGENT_ROW_TINT = 'bg-negative-muted/80'

/** The accent fill every open or checked row wears. */
const OPEN_ROW_FILL = 'bg-accent'

/**
 * The one fill a row wears, or null for the page. Open and checked win over the
 * urgent tint: they read the same on every row, and the red label and its icon
 * keep the row urgent on them. A hovered row takes the 40% wash every row does.
 * One answer, not two classes for `cn` to merge: tailwind-merge keeps only the
 * last of two `bg-*` utilities, so stacking them would let the tint drop the
 * open fill.
 */
export function inboxRowFill(
  row: Readonly<{ isActive: boolean; isChecked: boolean; isUrgent: boolean }>,
): string | null {
  if (row.isActive || row.isChecked) return OPEN_ROW_FILL
  return row.isUrgent ? URGENT_ROW_TINT : null
}

/** A signal's glyph: a lucide icon, or the priority's signal bars. */
type SignalIcon = ComponentType<Readonly<{ className?: string; 'aria-hidden'?: 'true' }>>

export type InboxRowSignalTone = Readonly<{ ink: string; Icon: SignalIcon }>

const ESCALATED: InboxRowSignalTone = { ink: TONE_INK.negative, Icon: Flag }
const URGENT: InboxRowSignalTone = { ink: TONE_INK.negative, Icon: TONE_ICON.negative }
// High (owner D-3 / P-8): the word in the page ink with the three-bar glyph,
// and no tint. The bars carry the level by shape, so the cue needs no colour.
const HIGH: InboxRowSignalTone = { ink: 'text-foreground', Icon: HighPriorityGlyph }

/** The ink and icon a row signal prints in; null for a plain one (a reply state). */
export function inboxRowSignalTone(signal: InboxRowSignal): InboxRowSignalTone | null {
  if (signal === 'Escalated') return ESCALATED
  if (signal === 'Urgent') return URGENT
  if (signal === 'High') return HIGH
  return null
}
