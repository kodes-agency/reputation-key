import { ChevronRight } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { ReactNode } from 'react'
import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { topicLabel } from './guest-voice-words'

export function GuestVoiceIssueTitle({
  issueId,
  title,
  topic,
  sense = 'complaint',
  children,
}: Readonly<{
  issueId: string
  title: string
  topic: ReviewTopicV3
  sense?: 'complaint' | 'praise'
  children?: ReactNode
}>) {
  const { onOpenDetail } = useGuestVoice()
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
        {children}
      </span>
      <ChevronRight aria-hidden="true" className="text-muted-foreground" />
    </>
  )
  return onOpenDetail ? (
    <Button
      type="button"
      variant="ghost"
      size="inline"
      touch
      aria-haspopup="dialog"
      aria-label={`${title} · ${topicLabel(topic)} · ${sense}`}
      className="w-full justify-between gap-3 py-3 text-left whitespace-normal"
      onClick={() => onOpenDetail({ kind: 'issue', issueId, sense })}
    >
      {content}
    </Button>
  ) : (
    <div className="flex gap-3 py-3 text-sm">{content}</div>
  )
}
