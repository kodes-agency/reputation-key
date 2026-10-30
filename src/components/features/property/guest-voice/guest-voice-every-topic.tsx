import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import type {
  GuestVoiceTopicStatus,
  TopicRow,
} from '#/contexts/ai/application/public-api'
import { GuestVoiceDisclosure } from './guest-voice-disclosure'
import { topicStatusWords } from './guest-voice-check-in-words'
import { topicLabel } from './guest-voice-words'
import { useGuestVoice } from './guest-voice-context'

const TOPIC_STATUS: StatusMap<GuestVoiceTopicStatus> = {
  needs_attention: { label: topicStatusWords.needs_attention, tone: 'warn' },
  mixed: { label: topicStatusWords.mixed, tone: 'neutral' },
  doing_well: { label: topicStatusWords.doing_well, tone: 'positive' },
  great: { label: topicStatusWords.great, tone: 'positive' },
  unjudged: { label: topicStatusWords.unjudged, tone: 'neutral' },
}
const ORDER: readonly GuestVoiceTopicStatus[] = [
  'needs_attention',
  'mixed',
  'doing_well',
  'great',
  'unjudged',
]
export function GuestVoiceEveryTopic({ rows }: Readonly<{ rows: readonly TopicRow[] }>) {
  const [open, setOpen] = useState(false)
  const { onOpenDetail } = useGuestVoice()
  const sorted = [...rows].sort(
    (a, b) =>
      ORDER.indexOf(a.assessment.status) - ORDER.indexOf(b.assessment.status) ||
      (a.assessment.happyShare ?? 1) - (b.assessment.happyShare ?? 1),
  )
  const list = (shown: readonly TopicRow[]) => (
    <ul className="divide-y">
      {shown.map((row) => (
        <li key={row.topic}>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between gap-2 py-3 text-left whitespace-normal"
            size="inline"
            touch
            disabled={!onOpenDetail}
            aria-haspopup={onOpenDetail ? 'dialog' : undefined}
            onClick={() => onOpenDetail?.({ kind: 'topic', topic: row.topic })}
          >
            <span className="flex-1">{topicLabel(row.topic)}</span>
            <StatusBadge status={row.assessment.status} map={TOPIC_STATUS} />
            <ChevronRight aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  )
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border bg-card p-4"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between whitespace-normal text-left"
        >
          Every part of your property
          <ChevronRight aria-hidden="true" className={open ? 'rotate-90' : undefined} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="py-2 text-sm text-muted-foreground">
          Grouped by how guests feel, with the parts needing attention first. Fewer than
          six reviews stays unjudged.
        </p>
        {list(sorted.slice(0, 3))}
        {sorted.length > 3 ? (
          <GuestVoiceDisclosure label={`Show ${sorted.length - 3} more parts`}>
            {list(sorted.slice(3))}
          </GuestVoiceDisclosure>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
