import { useEffect, useId, useRef, useState } from 'react'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { CheckIcon, LockIcon, PencilIcon } from './immersive-icons'
import { ImmersiveNoteForm, type NoteSubmission } from './immersive-note-form'

export type { NoteSubmission } from './immersive-note-form'

/** The note the page starts with: closed and empty, unless a story or preview says otherwise. */
export type NoteDraft = Readonly<{ open?: boolean; text?: string }>

/**
 * The private note card (boards G04, G06, G07), offered after the Google card
 * and only when the server says the guest may write one. It starts collapsed,
 * opens into a field, and once the note is sent becomes a confirmation.
 */
export function ImmersiveNoteCard({
  pack,
  displayName,
  sent,
  pending,
  sendFailed,
  initial,
  onSubmit,
}: Readonly<{
  pack: GuestPortalCopyV2
  displayName: string
  /** The server holds a note for this response. */
  sent: boolean
  pending: boolean
  sendFailed: boolean
  initial?: NoteDraft
  /** Resolves true when the note was accepted. */
  onSubmit: (value: NoteSubmission) => Promise<boolean>
}>) {
  if (sent) return <SentNote pack={pack} displayName={displayName} />
  return (
    <NoteComposer
      pack={pack}
      displayName={displayName}
      pending={pending}
      sendFailed={sendFailed}
      initial={initial}
      onSubmit={onSubmit}
    />
  )
}

function SentNote({
  pack,
  displayName,
}: Readonly<{ pack: GuestPortalCopyV2; displayName: string }>) {
  return (
    <div className="ih-note ih-note--sent" role="status">
      <span className="ih-disc">
        <CheckIcon size={20} />
      </span>
      <p>{guestCopyText(pack, 'noteSent', { name: displayName })}</p>
    </div>
  )
}

function NoteComposer({
  pack,
  displayName,
  pending,
  sendFailed,
  initial,
  onSubmit,
}: Readonly<{
  pack: GuestPortalCopyV2
  displayName: string
  pending: boolean
  sendFailed: boolean
  initial?: NoteDraft
  onSubmit: (value: NoteSubmission) => Promise<boolean>
}>) {
  const id = useId()
  const [open, setOpen] = useState(initial?.open ?? false)
  const field = useRef<HTMLTextAreaElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  // Focus moves only when the guest opens or closes the note, never on first render.
  const moveFocus = useRef(false)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    ;(open ? field.current : opener.current)?.focus()
  }, [open])

  const toggle = (next: boolean) => {
    moveFocus.current = true
    setOpen(next)
  }

  return (
    <section className="ih-note" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="ih-display ih-card-title ih-card-title--small">
        {pack.copy.noteOfferTitle}
      </h2>
      <p className="ih-note__hint">
        <LockIcon size={16} />
        <span>{guestCopyText(pack, 'noteOfferBody', { name: displayName })}</span>
      </p>
      {open ? (
        <ImmersiveNoteForm
          pack={pack}
          idPrefix={id}
          initialText={initial?.text ?? ''}
          fieldRef={field}
          pending={pending}
          sendFailed={sendFailed}
          onSubmit={onSubmit}
          onDismiss={() => toggle(false)}
        />
      ) : (
        <button
          ref={opener}
          type="button"
          className="ih-button ih-button--outline"
          onClick={() => toggle(true)}
        >
          <PencilIcon size={18} />
          {pack.copy.noteOfferAction}
        </button>
      )}
    </section>
  )
}
