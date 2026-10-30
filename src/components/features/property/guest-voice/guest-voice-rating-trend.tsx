import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { useViewportBelow } from '#/components/hooks/use-viewport-below'
import type { GuestVoiceRatingTrend as Trend } from '#/contexts/ai/application/public-api'
import { GuestVoiceSection } from './guest-voice-section'
import { GuestVoiceRatingChart } from './guest-voice-rating-chart'
import { ratingComparisonLabels, trendAnswer } from './guest-voice-check-in-words'
import { formatLocalDate } from '#/lib/format'
import { starsText } from './guest-voice-words'

export function GuestVoiceRatingTrend({ trend }: Readonly<{ trend: Trend }>) {
  const phone = useViewportBelow(768)
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null)
  const open = chosenOpen ?? !phone
  const comparison = (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">Guests who left a comment gave</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {(
          [
            ['Before', trend.before],
            ['Since', trend.recent],
          ] as const
        ).map(([label, period], index) => (
          <p key={label}>
            {index === 1 ? <span aria-hidden="true">→ </span> : null}
            <span className="sr-only">
              {label}: {ratingComparisonLabels(period)} ·{' '}
            </span>
            <span aria-hidden="true">
              {label} {formatLocalDate(trend.recent.startLocalDate, { year: false })}{' '}
              <strong className="font-semibold">
                {period.averageStars === null
                  ? 'Not available'
                  : starsText(period.averageStars)}
              </strong>
            </span>
            <span className="sr-only">
              {period.averageStars === null
                ? 'Not available'
                : `${period.averageStars.toFixed(1)} stars`}
            </span>
          </p>
        ))}
      </div>
    </div>
  )
  return (
    <GuestVoiceSection
      title="Are guests happier lately?"
      icon={trend.verdict === 'slipping' ? 'down' : 'up'}
      answer={trendAnswer(trend.verdict)}
      tone={
        trend.verdict === 'improving'
          ? 'positive'
          : trend.verdict === 'slipping'
            ? 'warn'
            : 'neutral'
      }
      aside={trend.verdict === 'not_enough' ? undefined : comparison}
    >
      <Collapsible open={open} onOpenChange={setChosenOpen}>
        <CollapsibleContent>
          <GuestVoiceRatingChart
            months={trend.months}
            recentStart={trend.recent.startLocalDate}
            tone={
              trend.verdict === 'improving'
                ? 'positive'
                : trend.verdict === 'slipping'
                  ? 'warn'
                  : 'neutral'
            }
          />
        </CollapsibleContent>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost">
            {open ? 'Hide each month' : 'See each month'}
            <ChevronDown aria-hidden="true" className={open ? 'rotate-180' : undefined} />
          </Button>
        </CollapsibleTrigger>
      </Collapsible>
      {trend.reason === 'analysis_incomplete' ? (
        <p className="text-sm text-muted-foreground">
          Changes appear once your reviews are analysed.
        </p>
      ) : null}
    </GuestVoiceSection>
  )
}
