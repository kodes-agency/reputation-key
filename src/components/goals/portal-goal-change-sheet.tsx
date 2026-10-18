// The sheet that changes the Monthly portal goal (PLAN PG-14; copy deck S-1,
// S-15…S-23, F-1, F-2): "November, now" or "From Dec 1", the number box, what
// the number is, a note on the way it starts the month when it is behind, the
// other measure (from the next month only), and "Add a note". The primary
// sends "now" as a change of the running month and the months after it, and
// "from next month" as a revision; a toast says what was saved.
//
// It works from the goal as the sheet opened on it, never from a read that
// moved on under it. A refusal is said in the banner above the footer: when
// someone changed the goal (F-1) the goal is read again and the sheet opens
// afresh on the latest, still saying so; when the month has ended (F-2) the
// change goes to the next month. Part of the sheet's chunk.
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import type { PortalGoalSheetProps } from './portal-goal-sheet'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
  type PortalGoalChangeModel,
  type PortalGoalChangeSubmission,
} from './portal-goal-sheet-change-view'
import { PortalGoalSheetFrame } from './portal-goal-sheet-frame'
import { changeRefusals, PORTAL_GOAL_BEHIND } from './portal-goal-sheet-refusals'

type Props = PortalGoalSheetProps &
  Readonly<{
    goal: PortalGoalOfCard
    change: PortalGoalChangeFacts
    measure: PortalGoalMeasure
  }>

type Sent = Readonly<{ submission: PortalGoalChangeSubmission; toast: string }>

/** The change, sent once however often it is pressed, and what follows it. */
function useChangeCommand(props: Props, onMonthEnded: () => void) {
  const sending = useRef(false)
  const [sent, setSent] = useState(false)
  const { commands, change, propertyId } = props
  const run = ({ submission }: Sent) =>
    submission.when === 'now'
      ? commands.changeMonthlyPortalGoalNowFn({
          data: { propertyId, ...submission.data },
        })
      : commands.reviseMonthlyPortalGoalFn({ data: { propertyId, ...submission.data } })
  const month = change.now?.monthKey ?? change.nextMonthKey
  const save = useActionMutation(
    withGoalRefusals(run, changeRefusals(month, change.nextMonthKey)),
    {
      onSuccess: async (_output, { toast: text }) => {
        toast.success(text)
        await commands.onSet()
        props.onSettled()
      },
      onError: (error) => {
        const code = goalRefusalCode(error) ?? ''
        if (code === 'month_locked') onMonthEnded()
        if (!PORTAL_GOAL_BEHIND.has(code)) return
        // F-1: the host reads the goal again and opens the sheet on the latest.
        if (code === 'revision_conflict') props.onConflict?.(error)
        void commands.onSet()
      },
    },
  )
  const send = (input: Sent) => {
    if (sending.current) return
    sending.current = true
    setSent(true)
    void save(input)
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  // The refusal the sheet opened with is said until the next press.
  const notice = sent ? null : (props.notice ?? null)
  return { send, pending: save.isPending, error: save.error, notice }
}

/** S-19: "Add a note", then the field, which takes the focus as it appears. */
function NoteField({
  note,
  pending,
  onOpen,
  onType,
}: Readonly<{
  note: PortalGoalChangeModel['note']
  pending: boolean
  onOpen: () => void
  onType: (text: string) => void
}>) {
  const id = useId()
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (note.open) field.current?.focus()
  }, [note.open])
  if (!note.open) {
    return (
      <Button
        type="button"
        variant="link"
        size="inline"
        touch
        className="self-start"
        disabled={pending}
        onClick={onOpen}
      >
        Add a note
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Note</Label>
      <Input
        ref={field}
        id={id}
        value={note.text}
        maxLength={note.limit}
        disabled={pending}
        onChange={(event) => onType(event.target.value)}
      />
    </div>
  )
}

export function PortalGoalChangeSheet(props: Props) {
  const { goal, change, facts } = props
  const [now] = useState(() => props.now ?? new Date())
  const context: PortalGoalChangeContext = { goal, change, facts, now }
  const [draft, setDraft] = useState(() => openingChangeDraft(context, props.measure))
  const model = portalGoalChangeModel(draft, context)
  const edit = (next: Parameters<typeof changedChangeDraft>[1]) =>
    setDraft((current) => changedChangeDraft(current, next, context))
  const { send, pending, error, notice } = useChangeCommand(props, () =>
    edit({ kind: 'now_closed' }),
  )
  return (
    <PortalGoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      title={model.title}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalSheetBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          notice={notice}
          onChange={edit}
          onSubmit={() => {
            if (model.submission !== null && model.toast !== null) {
              send({ submission: model.submission, toast: model.toast })
            }
          }}
          note={
            <NoteField
              note={model.note}
              pending={pending}
              onOpen={() => edit({ kind: 'note_open' })}
              onType={(text) => edit({ kind: 'note', text })}
            />
          }
        />
      )}
    </PortalGoalSheetFrame>
  )
}
