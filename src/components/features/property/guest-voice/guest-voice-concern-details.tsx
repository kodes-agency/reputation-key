import type { GuestVoiceConcernDrawer } from '#/contexts/ai/application/public-api'
import { GuestVoiceEvidence } from './guest-voice-evidence'
import { GuestVoiceIssueActions } from './guest-voice-issue-actions'
import { GuestVoiceMonthBars } from './guest-voice-month-bars'
import { CONCERN_WORDS } from './guest-voice-urgent'
import { lastReportedText } from './guest-voice-check-in-words'

export function GuestVoiceConcernDetails({
  drawer,
}: Readonly<{ drawer: GuestVoiceConcernDrawer }>) {
  return (
    <>
      <p className="text-sm">
        {drawer.reviewCount} {drawer.reviewCount === 1 ? 'guest' : 'guests'} reported this
        · {lastReportedText(drawer.lastReportedLocalDate)}
      </p>
      <p className="text-sm text-negative">
        {CONCERN_WORDS[drawer.reason]} · a guest report, not a verified finding.
      </p>
      <GuestVoiceEvidence drawer={drawer} />
      <div className="hidden md:block">
        <GuestVoiceIssueActions
          scope={drawer.matchingReviews}
          reviewCount={drawer.reviewCount}
        />
      </div>
      <GuestVoiceMonthBars series={drawer.monthlySeries} />
    </>
  )
}
