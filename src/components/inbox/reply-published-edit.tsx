import { ReviewReplyPublishedEditor } from './reply-editor-views'
import type { ReplyData } from './reply-status-view'

type ReplyEntity = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

type Props = Readonly<{
  reply: ReplyEntity
  isSaving: boolean
  onSaveEdit: (text: string) => Promise<unknown>
  onClose: () => void
}>

/**
 * The edit-and-republish editor for a reply that already reached Google. It no
 * longer renders a read-only view first — the thread carries the message, and
 * keeps carrying it while this editor is open — so whether it is open is the
 * pane's `editTarget`, not a local flag. That flag could not survive its own
 * save anyway: the cache patch that follows a republish re-resolves the reply
 * to `approved` and unmounts this subtree mid-`setState`.
 */
export function ReplyPublishedEditor({ reply, isSaving, onSaveEdit, onClose }: Props) {
  return (
    <ReviewReplyPublishedEditor
      reply={reply}
      isSaving={isSaving}
      onSave={async (text) => {
        await onSaveEdit(text)
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
