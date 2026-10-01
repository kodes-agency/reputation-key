import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveRatingForm, type RatingSubmission } from './immersive-rating-form'
import type { ResponseRow } from './immersive-response-rows'

/**
 * One row of "Your response": what it does, until when, and its button. A row
 * whose time has ended says so and has no button. `below` is whatever the row
 * opens under itself (the rating form, the confirmation).
 */
function RowShell({
  row,
  button,
  below,
}: Readonly<{ row: ResponseRow; button: ReactNode; below?: ReactNode }>) {
  return (
    <li className="ih-yr__row">
      <div className="ih-yr__row-main">
        <div className="ih-yr__row-text">
          <p className="ih-yr__row-title">{row.title}</p>
          {row.detail !== '' && <p className="ih-yr__detail">{row.detail}</p>}
        </div>
        {row.actionable && button}
      </div>
      {below}
    </li>
  )
}

/** The button of a row. A native button, so Enter and Space work as they do everywhere. */
function RowButton({
  row,
  pending,
  onClick,
  buttonRef,
  expanded,
  controls,
}: Readonly<{
  row: ResponseRow
  pending: boolean
  onClick: () => void
  buttonRef?: RefObject<HTMLButtonElement | null>
  expanded?: boolean
  controls?: string
}>) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="ih-button ih-button--outline ih-yr__button"
      aria-label={row.actionName}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={pending}
      onClick={onClick}
    >
      {row.actionLabel}
    </button>
  )
}

/**
 * "Change your rating". The button opens the rating form under the row, on the
 * guest's current star and with the pack's "Save new rating"; pressing it again
 * puts the form away. Whether the form is open is the section's to say (the
 * receipt's Change opens it too). Focus goes into the form when it opens and
 * back to the button when it closes, never on first render.
 */
export function ChangeRatingRow({
  pack,
  row,
  response,
  pending,
  ratingFailed,
  changing,
  announced,
  onChangingChange,
  onChangeRating,
}: Readonly<{
  pack: GuestPortalCopyV2
  row: ResponseRow
  response: GuestResponseView
  pending: boolean
  ratingFailed: boolean
  changing: boolean
  /** A status is being read out, and takes focus: the button does not. */
  announced: boolean
  onChangingChange: (changing: boolean) => void
  onChangeRating: (value: RatingSubmission) => Promise<void>
}>) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  // False on mount: the form can only be open at mount when the receipt's Change
  // opened the section and the form together, and then focus belongs in it.
  const wasChanging = useRef(false)

  useEffect(() => {
    if (changing && !wasChanging.current) {
      form.current
        ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
        ?.focus()
    } else if (!changing && wasChanging.current && !announced) {
      button.current?.focus()
    }
    wasChanging.current = changing
  }, [changing, announced])

  const open = changing && row.actionable
  return (
    <RowShell
      row={row}
      button={
        <RowButton
          row={row}
          pending={pending}
          buttonRef={button}
          expanded={open}
          controls={open ? `${id}-form` : undefined}
          onClick={() => onChangingChange(!changing)}
        />
      }
      below={
        open && (
          <div
            id={`${id}-form`}
            ref={form}
            className="ih-yr__change"
            onKeyDown={(event) => {
              if (event.key === 'Escape') onChangingChange(false)
            }}
          >
            <ImmersiveRatingForm
              pack={pack}
              idPrefix={`${id}-change`}
              pending={pending}
              saveFailed={ratingFailed}
              initialRating={response.rating ?? 0}
              submitLabel={pack.copy.responseChangeSave}
              onSubmit={onChangeRating}
            />
          </div>
        )
      }
    />
  )
}

/** "Remove your note": one press, since a note alone is small and its words are the guest's to take back. */
export function RemoveNoteRow({
  row,
  pending,
  onRemove,
}: Readonly<{ row: ResponseRow; pending: boolean; onRemove: () => void }>) {
  return (
    <RowShell
      row={row}
      button={<RowButton row={row} pending={pending} onClick={onRemove} />}
    />
  )
}

/**
 * "Remove your rating and note". This one cannot be undone, so the button asks
 * first: the question replaces the button, the safe answer ("Keep them") is the
 * filled one, and Escape means no. Focus goes to the question when it opens and
 * back to the button when it is put away, and a keyboard guest reaches the
 * answers by Tab. Nothing is sent until "Remove both".
 */
export function RemoveAllRow({
  pack,
  row,
  pending,
  onRemove,
}: Readonly<{
  pack: GuestPortalCopyV2
  row: ResponseRow
  pending: boolean
  onRemove: () => void
}>) {
  const id = useId()
  const [confirming, setConfirming] = useState(false)
  const question = useRef<HTMLParagraphElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    ;(confirming ? question.current : button.current)?.focus()
  }, [confirming])

  const setConfirmation = (next: boolean) => {
    moveFocus.current = true
    setConfirming(next)
  }
  const asking = confirming && row.actionable

  return (
    <RowShell
      row={row}
      button={
        asking ? null : (
          <RowButton
            row={row}
            pending={pending}
            buttonRef={button}
            onClick={() => setConfirmation(true)}
          />
        )
      }
      below={
        asking && (
          <div
            role="group"
            aria-labelledby={`${id}-question`}
            className="ih-yr__confirm"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirmation(false)
            }}
          >
            <p
              id={`${id}-question`}
              ref={question}
              tabIndex={-1}
              className="ih-yr__confirm-title"
            >
              {pack.copy.responseRemoveAllConfirmTitle}
            </p>
            <p className="ih-yr__detail">{pack.copy.responseRemoveAllConfirmBody}</p>
            <div className="ih-yr__confirm-actions">
              <button
                type="button"
                className="ih-button ih-button--primary ih-yr__button"
                disabled={pending}
                onClick={() => setConfirmation(false)}
              >
                {pack.copy.responseRemoveAllCancel}
              </button>
              <button
                type="button"
                className="ih-button ih-button--outline ih-yr__button"
                disabled={pending}
                onClick={() => {
                  setConfirmation(false)
                  onRemove()
                }}
              >
                {pack.copy.responseRemoveAllConfirm}
              </button>
            </div>
          </div>
        )
      }
    />
  )
}
