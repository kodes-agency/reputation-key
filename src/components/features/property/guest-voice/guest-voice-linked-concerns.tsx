import { Button } from '#/components/ui/button'
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
          className="justify-start whitespace-normal text-left"
          data-detail-focus={item.key}
          onClick={() =>
            onOpenDetail?.({
              kind: 'concern',
              issueId: item.issueId,
              reason: item.urgentReason,
            })
          }
        >
          <span>
            <span className="block text-negative">
              Linked serious concern · {CONCERN_WORDS[item.urgentReason]}
            </span>
            {item.title}
            <span className="block text-xs font-normal text-muted-foreground">
              Some reviews mention both; this is not proof of a cause.
            </span>
          </span>
        </Button>
      ))}
    </div>
  )
}
