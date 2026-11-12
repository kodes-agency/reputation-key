// The shape of one History sentence: a disc, the person, what they did, and the
// detail after the dot. Kept apart so the sentence builders can share it.

import type { Phrase } from './portal-history-phrase'

export type HistoryGlyph =
  | 'created'
  | 'edit'
  | 'published'
  | 'restored'
  | 'code'
  | 'download'
  | 'copy'
  | 'stopped'
  | 'health_ok'
  | 'health_warn'
  | 'health_off'

export type HistoryLine = Readonly<{
  glyph: HistoryGlyph
  /** The person, or null when nobody is named (a system fact). */
  actor: string | null
  /** What was done, after the person. */
  action: Phrase
  /** After the dot: the wording, the reason, what the version added. */
  detail: Phrase | null
}>
