import { useState, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { ReviewCauseForm } from './review-cause-form'
import { chipSentence, correctionWord } from './review-cause-view'
import {
  correctionRows,
  mayBeNoProblem,
  topicOfRow,
  type CorrectionRow,
} from './review-correction-view'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'
import type { MentionCorrectionAction } from '#/contexts/ai/application/public-api'
import type { useReviewCorrection } from './use-review-correction'

type Correction = ReturnType<typeof useReviewCorrection>

/** A button that says a thing about one reading, and names the reading it is about. */
function RowAction({
  label,
  reading,
  pending,
  disabled,
  onClick,
}: Readonly<{
  label: string
  reading: string
  pending: boolean
  disabled: boolean
  onClick: () => void
}>): ReactNode {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`${label}: ${reading}`}
      pending={pending}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

/**
 * What can be said of one reading: set its topic aside, call a complaint no problem,
 * change its cause, or give the AI's reading back. Each is a click that takes effect at
 * once, except the cause, which opens its form under the line.
 */
function ReadingRow({
  mention,
  topic,
  correction,
  editing,
  onEdit,
}: Readonly<{
  mention: InboxMentionV3
  topic: string
  correction: Correction
  editing: boolean
  onEdit: (ordinal: number | null) => void
}>): ReactNode {
  const [busy, setBusy] = useState<string | null>(null)
  const reading = chipSentence(mention)
  const word = correctionWord(mention)
  const run = async (key: string, action: MentionCorrectionAction) => {
    setBusy(key)
    await correction.apply({ mentionOrdinal: mention.mentionOrdinal, action })
    setBusy(null)
  }
  const action = (key: string, label: string, said: MentionCorrectionAction) => (
    <RowAction
      label={label}
      reading={reading}
      pending={busy === key}
      disabled={correction.isPending}
      onClick={() => void run(key, said)}
    />
  )

  return (
    <li className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0">
      <p className="text-sm font-medium">{reading}</p>
      <p className="text-xs text-muted-foreground">
        {word === null ? topic : `${topic} · ${word}`}
      </p>
      {editing ? (
        <ReviewCauseForm
          mention={mention}
          mutation={correction.submission}
          onCancel={() => onEdit(null)}
          onSubmit={async (cause) => {
            const outcome = await correction.submit({
              mentionOrdinal: mention.mentionOrdinal,
              action: { kind: 'change_cause', ...cause },
            })
            if (outcome.kind === 'done') onEdit(null)
            return outcome
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {action('remove', 'Remove topic', { kind: 'remove_topic' })}
          {mayBeNoProblem(mention)
            ? action('no-problem', 'Not a problem', { kind: 'not_a_problem' })
            : null}
          <RowAction
            label="Change cause"
            reading={reading}
            pending={false}
            disabled={correction.isPending}
            onClick={() => onEdit(mention.mentionOrdinal)}
          />
          {mention.correction === null ? null : action('undo', 'Undo', { kind: 'undo' })}
        </div>
      )}
    </li>
  )
}

/** A topic a manager set aside: one line, and the way to give it back whole. */
function RemovedRow({
  mention,
  topic,
  correction,
}: Readonly<{
  mention: InboxMentionV3
  topic: string
  correction: Correction
}>): ReactNode {
  const [busy, setBusy] = useState(false)
  return (
    <li className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0">
      <p className="text-sm font-medium">{topic}</p>
      <p className="text-xs text-muted-foreground">Removed from this review</p>
      <div className="flex flex-wrap gap-2">
        <RowAction
          label="Undo"
          reading={topic}
          pending={busy}
          disabled={correction.isPending}
          onClick={() => {
            setBusy(true)
            void correction
              .apply({ mentionOrdinal: mention.mentionOrdinal, action: { kind: 'undo' } })
              .then(() => setBusy(false))
          }}
        />
      </div>
    </li>
  )
}

function Row({
  row,
  correction,
  editing,
  onEdit,
}: Readonly<{
  row: CorrectionRow
  correction: Correction
  editing: boolean
  onEdit: (ordinal: number | null) => void
}>): ReactNode {
  const topic = topicOfRow(row)
  return row.kind === 'removed_topic' ? (
    <RemovedRow mention={row.mention} topic={topic} correction={correction} />
  ) : (
    <ReadingRow
      mention={row.mention}
      topic={topic}
      correction={correction}
      editing={editing}
      onEdit={onEdit}
    />
  )
}

/** Every reading of the review, each with what a manager may say of it. */
export function ReviewCorrectionRows({
  mentions,
  correction,
}: Readonly<{
  mentions: readonly InboxMentionV3[]
  correction: Correction
}>): ReactNode {
  // The reading whose cause is being changed. One at a time: two open forms would be two
  // sets of typed words and a banner each.
  const [editing, setEditing] = useState<number | null>(null)
  return (
    <ul aria-label="What the AI read in this review" className="grid gap-3">
      {correctionRows(mentions).map((row) => (
        <Row
          key={`${row.kind}:${row.mention.mentionOrdinal}`}
          row={row}
          correction={correction}
          editing={editing === row.mention.mentionOrdinal}
          onEdit={setEditing}
        />
      ))}
    </ul>
  )
}
