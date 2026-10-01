import { useForm } from '@tanstack/react-form'
import type { RefObject } from 'react'
import { submitHandler } from '#/components/forms/form-submit'
import { guestPrivateFeedbackFormDto } from '#/contexts/guest/application/dto/guest-response-form.dto'
import { PRIVATE_FEEDBACK_MAX_LENGTH } from '#/contexts/guest/application/dto/private-feedback.dto'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { ImmersiveBanner } from './immersive-banner'
import { ImmersiveHoneypot } from './immersive-honeypot'

export type NoteSubmission = Readonly<{ text: string; honeypot: string }>

/**
 * The open note: a labelled field, its hint, "Send note privately" and "Not
 * now". The words are the form's own state, validated on submit by the DTO the
 * server function checks (`guestPrivateFeedbackFormDto`); an empty or blank note
 * asks for words and sends nothing. The server call is the caller's.
 */
export function ImmersiveNoteForm({
  pack,
  idPrefix,
  initialText,
  fieldRef,
  pending,
  sendFailed,
  onSubmit,
  onDismiss,
}: Readonly<{
  pack: GuestPortalCopyV2
  idPrefix: string
  initialText: string
  fieldRef: RefObject<HTMLTextAreaElement | null>
  pending: boolean
  sendFailed: boolean
  /** Resolves true when the note was accepted. */
  onSubmit: (value: NoteSubmission) => Promise<boolean>
  onDismiss: () => void
}>) {
  const form = useForm({
    defaultValues: { text: initialText, honeypot: '' },
    validators: { onSubmit: guestPrivateFeedbackFormDto },
    onSubmit: async ({ value }) => {
      const parsed = guestPrivateFeedbackFormDto.parse(value)
      const accepted = await onSubmit({
        text: parsed.text,
        honeypot: parsed.honeypot ?? '',
      })
      if (accepted) form.reset()
    },
  })

  return (
    <form className="ih-note__form" onSubmit={submitHandler(form)} noValidate>
      <form.Field name="text">
        {(field) => (
          <>
            <label className="ih-note__label" htmlFor={`${idPrefix}-text`}>
              {pack.copy.noteLabel}
            </label>
            <textarea
              id={`${idPrefix}-text`}
              ref={fieldRef}
              className="ih-note__field"
              name={field.name}
              rows={4}
              maxLength={PRIVATE_FEEDBACK_MAX_LENGTH}
              value={field.state.value}
              disabled={pending}
              aria-describedby={
                field.state.meta.isValid
                  ? `${idPrefix}-hint`
                  : `${idPrefix}-hint ${idPrefix}-error`
              }
              aria-invalid={!field.state.meta.isValid}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <p id={`${idPrefix}-hint`} className="ih-note__fine">
              {pack.copy.noteHint}
            </p>
            {!field.state.meta.isValid && (
              <ImmersiveBanner
                id={`${idPrefix}-error`}
                message={pack.copy.noteRequired}
              />
            )}
          </>
        )}
      </form.Field>
      {sendFailed && <ImmersiveBanner message={pack.copy.noteSendFailed} />}
      <form.Field name="honeypot">
        {(field) => (
          <ImmersiveHoneypot
            id={`${idPrefix}-website`}
            label={pack.copy.honeypotLabel}
            value={field.state.value ?? ''}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <div className="ih-note__actions">
        <button type="submit" className="ih-button ih-button--primary" disabled={pending}>
          {pending ? pack.copy.sending : pack.copy.noteSend}
        </button>
        <button
          type="button"
          className="ih-text-button"
          disabled={pending}
          onClick={onDismiss}
        >
          {pack.copy.noteDismiss}
        </button>
      </div>
    </form>
  )
}
