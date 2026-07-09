// Inbox detail — read-only reply status views

import { Badge } from '#/components/ui/badge'
import { formatDateTime } from './utils'

type ReplyView = Readonly<{
  text: string
  publishedAt: Date | null
  rejectionReason: string | null
}>

export function ReviewReplyApproved({ reply }: Readonly<{ reply: ReplyView }>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline">Publishing...</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
    </div>
  )
}

export function ReviewReplyPublished({ reply }: Readonly<{ reply: ReplyView }>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge className="bg-green-100 text-green-800">Published</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      {reply.publishedAt && (
        <p className="text-xs text-muted-foreground">
          Published: {formatDateTime(reply.publishedAt)}
        </p>
      )}
    </div>
  )
}
