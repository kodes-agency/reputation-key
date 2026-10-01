import { useEffect, useId, useRef } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestCopyKeyV2, GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveBanner } from './immersive-banner'
import { ChevronDownIcon, RestartIcon } from './immersive-icons'
import type { RatingSubmission } from './immersive-rating-form'
import { ChangeRatingRow, RemoveAllRow, RemoveNoteRow } from './immersive-response-row'
import { responseSectionRows, type ResponseClock } from './immersive-response-rows'

/** A call from this section that did not go through. At most one message shows. */
export type ResponseSectionFailure = 'remove-note' | 'remove-all' | 'start-over'

/** What just worked, read out in the section. Starting over is the page's: the section is gone by then. */
export type ResponseSectionNotice = 'rating-updated' | 'note-removed'

const FAILURE_KEY = {
  'remove-note': 'responseRemoveNoteFailed',
  'remove-all': 'responseRemoveAllFailed',
  'start-over': 'startOverFailed',
} as const satisfies Record<ResponseSectionFailure, GuestCopyKeyV2>

const NOTICE_KEY = {
  'rating-updated': 'ratingUpdated',
  'note-removed': 'responseRemoveNoteDone',
} as const satisfies Record<ResponseSectionNotice, GuestCopyKeyV2>

export type ImmersiveResponseSectionProps = Readonly<{
  pack: GuestPortalCopyV2
  response: GuestResponseView
  clock: ResponseClock
  open: boolean
  /** The rating form is open under "Change your rating". */
  changing: boolean
  pending: boolean
  failure: ResponseSectionFailure | null
  /** Saving the changed rating did not reach the server; the message is in the form. */
  ratingFailed: boolean
  notice: ResponseSectionNotice | null
  onOpenChange: (open: boolean) => void
  onChangingChange: (changing: boolean) => void
  onChangeRating: (value: RatingSubmission) => Promise<void>
  onRemoveNote: () => void
  onRemoveResponse: () => void
  onStartOver: () => void
}>

/**
 * "Your response" (board G07): one collapsible section with the guest's four
 * choices, change the rating, remove the note, remove the rating and note, and
 * start over on a shared device. It is the last card of the after-rating page
 * and says the same at every rating (ADR 0044): it holds the guest's own
 * controls, never a view of how they rated.
 *
 * It is controlled and binds no action: the page hands in the state and the
 * handlers, like the rest of the response view. The deadlines are written from
 * `clock`, the portal's own zone and a `now` that travels with the page data.
 */
export function ImmersiveResponseSection(props: ImmersiveResponseSectionProps) {
  const { pack, open, onOpenChange } = props
  const id = useId()
  return (
    <section
      className="ih-yr"
      data-open={open ? 'true' : 'false'}
      aria-labelledby={`${id}-title`}
    >
      <h2 className="ih-yr__heading">
        <button
          type="button"
          className="ih-yr__toggle"
          aria-expanded={open}
          aria-controls={open ? `${id}-body` : undefined}
          onClick={() => onOpenChange(!open)}
        >
          <span className="ih-yr__labels">
            <span id={`${id}-title`} className="ih-yr__title">
              {pack.copy.responseTitle}
            </span>
            <span className="ih-yr__summary">{pack.copy.responseSummary}</span>
          </span>
          <ChevronDownIcon size={18} className="ih-yr__chevron" />
        </button>
      </h2>
      {open && <SectionBody {...props} id={`${id}-body`} />}
    </section>
  )
}

function SectionBody({
  id,
  pack,
  response,
  clock,
  changing,
  pending,
  failure,
  ratingFailed,
  notice,
  onChangingChange,
  onChangeRating,
  onRemoveNote,
  onRemoveResponse,
  onStartOver,
}: ImmersiveResponseSectionProps & Readonly<{ id: string }>) {
  const status = useRef<HTMLParagraphElement>(null)
  const hadNotice = useRef(notice !== null)

  // A removed note takes its button with it, and focus with the button: the
  // confirmation takes it, and a screen reader reads it out. A page that opens
  // with a notice already showing keeps focus where it is.
  useEffect(() => {
    if (notice !== null && !hadNotice.current) status.current?.focus()
    hadNotice.current = notice !== null
  }, [notice])

  const rows = responseSectionRows(pack, response, clock)

  return (
    <div id={id} className="ih-yr__body">
      {notice && (
        <p role="status" tabIndex={-1} ref={status} className="ih-yr__notice">
          {pack.copy[NOTICE_KEY[notice]]}
        </p>
      )}
      {failure && <ImmersiveBanner message={pack.copy[FAILURE_KEY[failure]]} />}
      {rows.length > 0 && (
        <ul className="ih-yr__rows">
          {rows.map((row) => {
            switch (row.id) {
              case 'change':
                return (
                  <ChangeRatingRow
                    key={row.id}
                    pack={pack}
                    row={row}
                    response={response}
                    pending={pending}
                    ratingFailed={ratingFailed}
                    changing={changing}
                    announced={notice !== null}
                    onChangingChange={onChangingChange}
                    onChangeRating={onChangeRating}
                  />
                )
              case 'remove-note':
                return (
                  <RemoveNoteRow
                    key={row.id}
                    row={row}
                    pending={pending}
                    onRemove={onRemoveNote}
                  />
                )
              case 'remove-all':
                return (
                  <RemoveAllRow
                    key={row.id}
                    row={row}
                    pending={pending}
                    onRemove={onRemoveResponse}
                  />
                )
            }
          })}
        </ul>
      )}
      <div className="ih-yr__device">
        <p className="ih-yr__row-title">{pack.copy.sharedDeviceTitle}</p>
        <p className="ih-yr__detail">{pack.copy.sharedDeviceBody}</p>
        <button
          type="button"
          className="ih-button ih-button--outline ih-yr__start-over"
          disabled={pending}
          onClick={onStartOver}
        >
          <RestartIcon size={16} />
          {pack.copy.startOverAction}
        </button>
      </div>
    </div>
  )
}
