import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { TouchInlineLink } from '#/components/ui/inline-touch-link'

/**
 * What an AI notice update says, in one set of words wherever it is shown (the
 * banner's dialog, What's new): the changes, the way out, and the full notice.
 */
export function MerchantAiNoticeUpdateDetails({
  update,
  onFollow,
}: Readonly<{ update: MerchantAiNoticeUpdate; onFollow: () => void }>) {
  return (
    <>
      <ul className="list-disc space-y-3 pl-5 text-sm">
        {update.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <p className="text-sm">
        You can turn AI features off in each property&apos;s settings.
      </p>
      <p>
        <TouchInlineLink to="/settings/ai" onClick={onFollow}>
          Read the full AI notice
        </TouchInlineLink>
      </p>
    </>
  )
}
