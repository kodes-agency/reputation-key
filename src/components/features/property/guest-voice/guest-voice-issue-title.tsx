import { Button } from '#/components/ui/button'
import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { topicLabel } from './guest-voice-words'

/**
 * An issue's title, which opens its drawer when there is one: the name is the way in, as
 * a row's name is. Without a drawer it is only the name. The topic is named under it
 * unless the title already is the topic.
 */
export function GuestVoiceIssueTitle({
  issueId,
  title,
  topic,
}: Readonly<{ issueId: string; title: string; topic: ReviewTopicV3 }>) {
  const { onOpenIssue } = useGuestVoice()
  const topicName = topicLabel(topic)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h3 className="text-base font-semibold">
        {onOpenIssue === undefined ? (
          title
        ) : (
          <Button
            type="button"
            variant="link"
            size="inline"
            touch
            aria-haspopup="dialog"
            className="text-left text-base font-semibold whitespace-normal max-md:-my-2.5"
            onClick={() => onOpenIssue(issueId)}
          >
            {title}
          </Button>
        )}
      </h3>
      {title === topicName ? null : (
        <p className="text-sm text-muted-foreground">{topicName}</p>
      )}
    </div>
  )
}
