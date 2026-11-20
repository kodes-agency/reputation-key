// Share pace wording and tones; each goal retains its own rule for deciding pace.

import type { StatusMap } from '#/components/ui/status-badge'

/** The pace a goal is read at: the first days, on the way, or behind. */
export const GOAL_PACE_STATUS: StatusMap<'getting_started' | 'on_pace' | 'below_pace'> = {
  getting_started: { label: 'Getting started', tone: 'neutral' },
  on_pace: { label: 'On pace', tone: 'positive' },
  below_pace: { label: 'Below pace', tone: 'warn' },
}
