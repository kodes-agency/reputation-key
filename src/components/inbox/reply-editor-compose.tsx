// Inbox detail — reply composer for empty and draft states

import { useState } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { MAX_REPLY_LENGTH } from '#/contexts/review/domain/rules'

export type ReplyComposeProps = Readonly<{
  initialText: string
  isSaving: boolean
  onSaveDraft: (text: string) => Promise<unknown>
  onSubmit: (text: string) => Promise<unknown>
  onDelete?: () => Promise<unknown>
}>

export function ReplyCompose({
  initialText,
  isSaving,
  onSaveDraft,
  onSubmit,
  onDelete,
}: ReplyComposeProps) {
  const [text, setText] = useState(initialText)
  const charCount = text.length
  const isOverLimit = charCount > MAX_REPLY_LENGTH
  const canAct = text.trim().length > 0 && !isOverLimit && !isSaving

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Reply</h4>
        {onDelete && <Badge variant="secondary">Draft</Badge>}
      </div>
      <Textarea
        placeholder="Write a reply..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={isSaving}
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {charCount}/{MAX_REPLY_LENGTH}
        </span>
        <div className="flex gap-2">
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() => onDelete()}
            >
              Delete
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct}
            onClick={() => onSaveDraft(text)}
          >
            Save Draft
          </Button>
          <Button size="sm" disabled={!canAct} onClick={() => onSubmit(text)}>
            Submit for Approval
          </Button>
        </div>
      </div>
    </div>
  )
}
