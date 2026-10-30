import { ChevronRight } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
import type { ReactNode } from 'react'
import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceTopicIcon } from './guest-voice-topic-icon'
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
      <GuestVoiceTopicIcon topic={topic} row />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          data-issue-title
          className="text-base font-semibold [overflow-wrap:anywhere]"
        >
          {title}
        </span>
        <span className="sr-only">{topicLabel(topic)}</span>
        {children}
      </span>
      <ChevronRight aria-hidden="true" className="text-muted-foreground" />
    </>
  )
  return onOpenDetail ? (
    <Button
      type="button"
      variant="ghost"

      aria-haspopup="dialog"
      className="gap-3"
      onClick={() => onOpenDetail({ kind: 'issue', issueId, sense })}
    >
      {content}
    </Button>
  ) : (
    <div className="flex gap-3 py-3 text-sm">{content}</div>
  )
}
