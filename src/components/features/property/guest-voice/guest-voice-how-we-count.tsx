import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { SectionTitle } from '#/components/ui/section-title'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { GuestVoiceBasis } from './guest-voice-basis'

export function GuestVoiceHowWeCount({
  read,
  range,
}: Readonly<{ read: GuestVoiceV2Read; range: GuestVoiceRange }>) {
  const [open, setOpen] = useState(false)
  const context = read.status === 'ready' ? read : read.context
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ExplainTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          How we count
        </Button>
      </ExplainTrigger>
      <PopoverContent
        align="start"
        className="max-h-96 overflow-y-auto"
        onFocusOutside={() => setOpen(false)}
      >
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <SectionTitle>How we count</SectionTitle>
          <GuestVoiceBasis read={context} range={range} />
          <p>
            “Guests” means distinct Google reviews, not verified unique people. Repeated
            mentions in one review count once per topic.
          </p>
          <p>
            Patterns count {context.basis.analysedTextReviewCount} analysed comments. The
            trend uses all current reviews with comments, including those still being
            analysed. Star-only reviews are excluded from that comparison.
          </p>
          <p>
            The header’s Google rating is Google’s own number, with its verification date.
            It differs from the comment averages here.
          </p>
          <p>
            The recent period is the last quarter of this window, bounded to 7–90 days. We
            need at least 10 recent and 20 earlier comments. “Better” or “slipping” needs
            a likely change in the share of 4–5-star comments (95% central threshold, at
            least five percentage points) and an average change of at least 0.20 stars in
            the same direction. This is not a confidence interval for the mean. “About the
            same” means no clear change meeting that rule.
          </p>
          <p>
            Serious concerns cover reported safety or health risks, discrimination and
            legal threats, even in a single review. A concern is a group; several reviews
            can report it. These are reports, not verified findings.
          </p>
          <p>
            Parts stay unjudged below six mentioning reviews. Otherwise, happy means
            praise without a complaint: below 45% needs attention; 45–65% is mixed; 65–80%
            is doing well; 80% or more is great. Mixed and neutral comments remain in the
            denominator.
          </p>
          <p>
            Issue ranking uses stars at stake, an association rather than proof of what
            caused a rating. Other guests in issue comparisons means other analysed
            comments in this period.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
