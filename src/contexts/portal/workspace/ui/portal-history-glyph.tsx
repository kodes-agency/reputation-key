// The disc at the left of a History row. A person's own publish line wears
// their initials (the board's EP, GI); everything else wears a small glyph.
// The disc is decorative: the sentence beside it always says the same thing in
// words, and colour or shape never carries meaning alone.

import {
  CircleCheck,
  CirclePlus,
  CircleSlash,
  Copy,
  Download,
  History,
  Nfc,
  Pencil,
  QrCode,
  TriangleAlert,
} from 'lucide-react'
import { TimelineIndicator } from '#/components/ui/timeline'
import { personInitials } from '#/components/inbox/person-initials'
import type { HistoryGlyph } from './portal-history-line-types'

const SMALL_GLYPH = {
  created: CirclePlus,
  edit: Pencil,
  code: QrCode,
  download: Download,
  copy: Copy,
  stopped: CircleSlash,
  health_ok: CircleCheck,
  health_warn: TriangleAlert,
  health_off: CircleSlash,
} as const

export function HistoryGlyphDisc({
  glyph,
  actorName,
}: Readonly<{ glyph: HistoryGlyph; actorName: string | null }>) {
  if (glyph === 'published' || glyph === 'restored') {
    const initials = personInitials(actorName)
    return (
      <TimelineIndicator>{initials ?? <History aria-hidden="true" />}</TimelineIndicator>
    )
  }
  const Glyph = SMALL_GLYPH[glyph]
  return (
    <TimelineIndicator size="sm">
      {glyph === 'copy' ? <Nfc aria-hidden="true" /> : <Glyph aria-hidden="true" />}
    </TimelineIndicator>
  )
}
