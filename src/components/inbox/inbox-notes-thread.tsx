import { useForm } from '@tanstack/react-form'
import { useEffect, useRef } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextarea, type BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
// Receives addInboxNote server fn as a prop per src/components/CONTEXT.md "Server-function boundary".
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import { Send } from 'lucide-react'
import type {
  InboxNote,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { addInboxNoteFormDto } from '#/contexts/inbox/application/dto/inbox.dto'
import {
  DOCK_FOOT_ROW_CLASS,
  DOCK_SURFACE_CLASS,
  DOCK_TEXT_ROW_CLASS,
  DOCK_TEXTAREA_CLASS,
} from './composer-dock-rows'

type AddInboxNote = (
  input: Parameters<typeof addInboxNoteFn>[0],
) => Promise<InboxNote | InboxRevisionConflictResult>

type Props = Readonly<{
  inboxItemId: string
  expectedCommandRevision: number
  onNoteAdded: (resultingCommandRevision: number) => void
  addInboxNote: AddInboxNote
  canAdd?: boolean
  /**
   * The half-typed note, held by the pane.
   *
   * A mode switch no longer destroys this form: the composer's Reply / Note
   * segment is a real Radix tab set, but both of its panels are force-mounted
   * (`reply-composer.tsx`) and the inactive one is `hidden`, so flipping to the
   * reply box and back keeps the form instance and everything in it. That was
   * this prop's original reason and it no longer is.
   *
   * What it still carries is a change of SELECTION. The form is keyed by item,
   * so a new item rebuilds it; the words are hoisted to
   * `inbox-detail-content.tsx`, above that boundary, where they are fenced on
   * the item they were typed about. This is read ONCE, as the form's default
   * value, and `onDraftChange` is what keeps it current.
   */
  draftText?: string
  onDraftChange?: (text: string) => void
  /**
   * A bumped counter, not a flag: "put the caret here". The `n` shortcut has to
   * be able to ask twice, and an effect on a boolean only fires on its rising
   * edge. `0` means never asked.
   */
  caretRequest?: number
  /**
   * Whether this form's submit is the composer region's accent.
   *
   * `default` — the accent — is the right answer almost everywhere: in note
   * mode on a review item there is no other action in the region, and finding
   * 4's rule is that exactly one primary is visible. The exception is a
   * feedback item, whose region also hosts `Mark as handled` / `Correct
   * outcome` (row 10): THAT is the action the manager came for, so it takes
   * the accent and this one steps back to `outline`.
   *
   * The caller decides, because only the caller can see both controls; it
   * decides off `feedbackHandlingAction`, so the pairing cannot drift. Nothing
   * else about the button moves — the name `Add note` is pinned by two e2e
   * journeys (`inbox-triage.spec.ts:183-184`,
   * `activity-notification-facts.spec.ts:168-169`) and stays verbatim.
   */
  submitVariant?: 'default' | 'outline'
}>

/**
 * Writing an internal note — region 4's Note mode. The notes themselves are no
 * longer listed here: they are messages in `InboxThread`, interleaved with
 * handling events in the order they happened, so a manager reads one
 * conversation instead of a side list. That also retires the heading — the
 * textarea's own "Add a note" label is the only title this form needs, and the
 * guest message carries the pane's h2.
 *
 * The accessible names below are pinned by two e2e specs (`Add a note…`,
 * `Add note` — `inbox-triage.spec.ts:182-184`,
 * `activity-notification-facts.spec.ts:167-169`); the composer rebuild kept
 * both verbatim, and so does the variant knob below.
 */
export function InboxNotesThread({
  inboxItemId,
  expectedCommandRevision,
  onNoteAdded,
  addInboxNote,
  canAdd = true,
  draftText = '',
  onDraftChange,
  caretRequest = 0,
  submitVariant = 'default',
}: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const addNote = useActionMutation(addInboxNote, {
    successMessage: 'Note added',
    onSuccess: (_note, input) => {
      onNoteAdded(input.data.expectedCommandRevision + 1)
    },
  })

  const form = useForm({
    // Read once, at mount. The form's own store is the live value while it is
    // on screen; `onDraftChange` is what makes the next mount agree with it.
    defaultValues: { text: draftText },
    validators: { onSubmit: addInboxNoteFormDto },
    onSubmit: async ({ value }) => {
      const parsed = addInboxNoteFormDto.parse(value)
      await addNote({
        data: { inboxItemId, text: parsed.text, expectedCommandRevision },
      })
      // Both halves: `reset` takes the values it is given as the new defaults,
      // so a filed note has to leave the pane's copy empty too or the next
      // mount would seed the words that were just sent.
      onDraftChange?.('')
      form.reset({ text: '' })
    },
  })

  /**
   * The caret, on request. Mirrors `useEditorOpenFocus` for the note half,
   * minus its `scrollIntoView` — region 4 is pinned, so it is always in view.
   */
  useEffect(() => {
    if (caretRequest === 0) return
    formRef.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [caretRequest])

  if (!canAdd) return null

  /** The field the textarea gets: every keystroke also reaches the pane. */
  const mirrored = (field: BaseFieldApiTextarea): BaseFieldApiTextarea =>
    onDraftChange === undefined
      ? field
      : {
          ...field,
          handleChange: (value: string) => {
            onDraftChange(value)
            field.handleChange(value)
          },
        }

  return (
    // The dock's two writing rows (plan v2.1 row 14, `composer-dock-rows.ts`):
    // the form is the surface's column, the field is the TEXT row, `Add note`
    // is alone in the FOOT. This form used to be a free-standing stack — a
    // visible label, a bordered textarea and the button under it — and inside
    // the dock that stack sat on the dashed edge and, with no scroller of its
    // own, pushed `Add note` 53.5 px below a 320x568 viewport on a long note.
    // Now the text row takes the whole deficit and the foot keeps the primary
    // on screen, the same geometry the reply composer beside it has.
    <form ref={formRef} onSubmit={submitHandler(form)} className={DOCK_SURFACE_CLASS}>
      <form.Field name="text">
        {(field: BaseFieldApiTextarea) => (
          <>
            <div className={DOCK_TEXT_ROW_CLASS}>
              {/* Inside the row, inset to the text: a server refusal belongs
                  with the words it refused, and a banner outside the scroller
                  would be one more thing the foot has to make room for. */}
              {addNote.error ? (
                <div className="px-3 pt-2.5">
                  <FormErrorBanner error={addNote.error} />
                </div>
              ) : null}
              {/* The label stays — it is the field's accessible name, `Add a
                  note`, which `inbox-detail-content.stories.tsx` queries — but
                  is no longer printed: the head's `Note` tab and the
                  placeholder already say it, and the reply's text row prints
                  no label either. The textarea drops its own box for the
                  dock's (`DOCK_TEXTAREA_CLASS`). */}
              <FormTextarea
                field={mirrored(field)}
                id="inbox-note-text"
                label="Add a note"
                labelClassName="sr-only"
                textareaClassName={DOCK_TEXTAREA_CLASS}
                placeholder="Add a note…"
                rows={3}
                maxLength={5_000}
                disabled={addNote.isPending}
              />
            </div>
            {/* `justify-end`: the primary keeps the trailing edge, where
                `Submit for approval` sits in reply mode. No `max-md:h-11` any
                more — row 20 lowered v1's 44 px controls to 36, which is the
                button's own default height, in the PR that touches the file. */}
            <div className={`${DOCK_FOOT_ROW_CLASS} justify-end`}>
              <SubmitButton
                mutation={addNote}
                form={form}
                variant={submitVariant}
                disabled={!field.state.value?.trim()}
              >
                <Send className="size-3.5" />
                Add note
              </SubmitButton>
            </div>
          </>
        )}
      </form.Field>
    </form>
  )
}
