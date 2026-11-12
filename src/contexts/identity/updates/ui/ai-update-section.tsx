import { useId } from 'react'
import { Sparkles } from 'lucide-react'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { MerchantAiNoticeUpdateDetails } from '#/components/features/settings/merchant-ai-notice-update-details'
import { TONE_FILL, TONE_INK } from '#/components/ui/tone'
import { SectionTitle } from '#/components/ui/section-title'
import { formatDayMonthYear } from '#/lib/format'

/**
 * The AI notice update that leads What's new for an AccountAdmin: the same words
 * as the settings banner's dialog, compact, with the way to the full notice.
 */
export function AiUpdateSection({
  update,
  onFollow,
}: Readonly<{ update: MerchantAiNoticeUpdate; onFollow: () => void }>) {
  const labelId = useId()
  return (
    <section aria-labelledby={labelId} className="flex min-w-0 gap-3">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TONE_FILL.info} ${TONE_INK.info}`}
      >
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 space-y-2">
        <p id={labelId} className="text-xs font-medium text-muted-foreground">
          AI update
        </p>
        <SectionTitle level={2}>{update.title}</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Updated automatically on {formatDayMonthYear(update.renewedAt)}
        </p>
        <MerchantAiNoticeUpdateDetails update={update} onFollow={onFollow} />
      </div>
    </section>
  )
}
