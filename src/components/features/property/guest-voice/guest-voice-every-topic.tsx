import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
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
import { GuestVoiceTopicIcon } from './guest-voice-topic-icon'
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
            className="gap-2"

            disabled={!onOpenDetail}
            aria-haspopup={onOpenDetail ? 'dialog' : undefined}
            onClick={() => onOpenDetail?.({ kind: 'topic', topic: row.topic })}
          >
            <GuestVoiceTopicIcon topic={row.topic} row />
            <span className="flex-1 text-base font-semibold">
              {topicLabel(row.topic)}
            </span>
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
        <Button type="button" variant="ghost">
          <span>
            <span className="block text-base font-semibold">
              Every part of your property
            </span>
            <span className="block font-normal text-muted-foreground">
              How guests feel about {rows.length} parts, the ones that need attention
              first
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={open ? 'rotate-180' : undefined} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="py-2 text-sm text-muted-foreground">
          Grouped by how guests feel, with the parts needing attention first. Fewer than
          six reviews means this part stays unjudged.
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
