import { HeartPulse, ChevronRight } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
import type { UrgentConcernItem } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { CONCERN_WORDS } from './guest-voice-urgent'

export function GuestVoiceLinkedConcerns({
  items,
}: Readonly<{ items: readonly UrgentConcernItem[] }>) {
  const { onOpenDetail } = useGuestVoice()
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Button
          key={item.key}
          type="button"
          variant="outline"

          data-detail-focus={item.key}
          onClick={() =>
            onOpenDetail?.({
              kind: 'concern',
              issueId: item.issueId,
              reason: item.urgentReason,
            })
          }
        >
          <HeartPulse aria-hidden="true" className="size-5 text-negative" />
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-negative">
              Linked serious concern · {CONCERN_WORDS[item.urgentReason]}
            </span>
            {item.title}
          </span>
          <ChevronRight aria-hidden="true" />
        </Button>
      ))}
      <p className="text-sm text-muted-foreground">
        Some reviews mention both; this is not proof of a cause.
      </p>
    </div>
  )
}
