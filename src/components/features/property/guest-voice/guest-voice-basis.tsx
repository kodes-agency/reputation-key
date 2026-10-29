import type { GuestVoiceV2Ready } from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { windowDates, windowSentence } from './guest-voice-words'

/**
 * Which window this is and what is in it, before any figure that depends on both:
 * the sentence that names the window and why it is that one, the days it covers, and,
 * while reviews are still being analysed, that the figures can still move.
 */
export function GuestVoiceBasis({
  read,
  range,
}: Readonly<{ read: GuestVoiceV2Ready; range: GuestVoiceRange }>) {
  const dates = windowDates(read.startLocalDate, read.endLocalDate)
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p className="text-foreground">
        {windowSentence({
          range,
          window: read.window,
          textReviewCount: read.basis.textReviewCount,
          starOnlyCount: read.basis.starOnlyCount,
        })}
      </p>
      {dates === null ? null : <p>{dates}</p>}
      {read.provisional ? (
        <p>
          Some reviews are still being analysed, so these figures can still move. Changes
          are hidden until the analysis is complete.
        </p>
      ) : null}
    </div>
  )
}
