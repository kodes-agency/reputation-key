// The three paces a goal can be at, spelled once (ADR 0068, amended 2026-10-19:
// one goal design system). Every goal that has a pace draws it as the same pill,
// so the label and the tone of "On pace" are not written twice. What each goal
// counts as "on pace" stays its own rule; only the words and the tone are shared.
import type { StatusMap } from '#/components/ui/status-badge'

/** The pace a goal is read at: the first days, on the way, or behind. */
export const GOAL_PACE_STATUS: StatusMap<'getting_started' | 'on_pace' | 'below_pace'> = {
  getting_started: { label: 'Getting started', tone: 'neutral' },
  on_pace: { label: 'On pace', tone: 'positive' },
  below_pace: { label: 'Below pace', tone: 'warn' },
}
