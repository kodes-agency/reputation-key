import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { guestPrivateFeedbackFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import { guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveBanner } from './immersive-banner'
import { ImmersiveHoneypot } from './immersive-honeypot'
import { CheckIcon, LockIcon, PencilIcon } from './immersive-icons'

export type NoteSubmission = Readonly<{ text: string; honeypot: string }>

/** The note the page starts with: closed and empty, unless a story or preview says otherwise. */
export type NoteDraft = Readonly<{ open?: boolean; text?: string }>

const NOTE_MAX_LENGTH = 2_000

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
  const [text, setText] = useState(initial?.text ?? '')
  const [honeypot, setHoneypot] = useState('')
  const [required, setRequired] = useState(false)
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
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = guestPrivateFeedbackFormDto.shape.text.safeParse(text)
    if (!parsed.success) {
      setRequired(true)
      return
    }
    setRequired(false)
    await onSubmit({ text: parsed.data, honeypot })
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
        <form className="ih-note__form" onSubmit={(event) => void send(event)} noValidate>
          <label className="ih-note__label" htmlFor={`${id}-text`}>
            {pack.copy.noteLabel}
          </label>
          <textarea
            id={`${id}-text`}
            ref={field}
            className="ih-note__field"
            name="text"
            rows={4}
            maxLength={NOTE_MAX_LENGTH}
            value={text}
            disabled={pending}
            aria-describedby={`${id}-hint`}
            aria-invalid={required}
            onChange={(event) => {
              setText(event.target.value)
              setRequired(false)
            }}
          />
          <p id={`${id}-hint`} className="ih-note__fine">
            {pack.copy.noteHint}
          </p>
          {required && <ImmersiveBanner message={pack.copy.noteRequired} />}
          {sendFailed && <ImmersiveBanner message={pack.copy.noteSendFailed} />}
          <ImmersiveHoneypot
            id={`${id}-website`}
            label={pack.copy.honeypotLabel}
            value={honeypot}
            onChange={setHoneypot}
          />
          <div className="ih-note__actions">
            <button
              type="submit"
              className="ih-button ih-button--primary"
              disabled={pending}
            >
              {pending ? pack.copy.sending : pack.copy.noteSend}
            </button>
            <button
              type="button"
              className="ih-text-button"
              disabled={pending}
              onClick={() => toggle(false)}
            >
              {pack.copy.noteDismiss}
            </button>
          </div>
        </form>
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
