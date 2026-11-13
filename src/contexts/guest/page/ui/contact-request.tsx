// fallow-ignore-file unused-file
// Mounted only when contact requests launch; until then nothing imports this.
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { submitHandler } from '#/components/forms/form-submit'
import { Button } from '#/components/ui/button'
import { ImmersiveBanner } from '#/components/features/guest/public-portal/immersive/immersive-banner'
import { ImmersiveHoneypot } from '#/components/features/guest/public-portal/immersive/immersive-honeypot'
import {
  contactRequestEmailSchema,
  contactRequestNameSchema,
} from '../../contact-requests/contracts'

/** The words the guest reads. Held here until the approved copy joins the language packs. */
export const CONTACT_REQUEST_COPY = Object.freeze({
  heading: 'Want the property to get back to you about this?',
  body: 'Share your email and, if you like, your name. Only managers of this property who can see your feedback can read it, and only to follow up on it. It is hidden after 30 days and erased within a day after that. You can withdraw it here while this page is open and your session lasts, up to 24 hours; after that, use the contact route in the Privacy Notice.',
  emailLabel: 'Email',
  nameLabel: 'Name (optional)',
  consentLabel: 'I agree the property may contact me about this feedback.',
  send: 'Share my contact details',
  sending: 'Sending…',
  emailRequired: 'Enter an email address the property can reach you on.',
  consentRequired: 'Tick the box to share your contact details.',
  sendFailed: 'We could not send your details. Please try again.',
  sent: 'Thank you. The property will get back to you about your feedback. You can withdraw your details here for up to 24 hours.',
  withdraw: 'Withdraw my contact details',
  withdrawing: 'Withdrawing…',
  withdrawFailed: 'We could not withdraw your details. Please try again.',
  withdrawn: 'Your contact details were deleted.',
  honeypotLabel: 'Website',
})

const contactRequestFormSchema = z.object({
  email: contactRequestEmailSchema,
  name: z.union([contactRequestNameSchema, z.literal('')]),
  consent: z.literal(true),
  honeypot: z.string().max(256),
})

export type ContactRequestSubmission = Readonly<{
  email: string
  name?: string
  consent: true
  honeypot: string
}>

export type ContactRequestStage = 'offer' | 'sent' | 'withdrawn'

export function GuestContactRequest({
  idPrefix,
  stage,
  pending,
  failed,
  onSubmit,
  onWithdraw,
}: Readonly<{
  idPrefix: string
  stage: ContactRequestStage
  pending: boolean
  failed: boolean
  /** Resolves true when the request was accepted. */
  onSubmit: (value: ContactRequestSubmission) => Promise<boolean>
  /** Resolves true when the details were deleted. */
  onWithdraw: () => Promise<boolean>
}>) {
  const form = useForm({
    defaultValues: { email: '', name: '', consent: false, honeypot: '' },
    validators: { onSubmit: contactRequestFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = contactRequestFormSchema.parse(value)
      const accepted = await onSubmit({
        email: parsed.email,
        ...(parsed.name === '' ? {} : { name: parsed.name }),
        consent: true,
        honeypot: parsed.honeypot,
      })
      if (accepted) form.reset()
    },
  })

  if (stage === 'withdrawn') {
    return (
      <p className="ih-note__fine" role="status">
        {CONTACT_REQUEST_COPY.withdrawn}
      </p>
    )
  }

  if (stage === 'sent') {
    return (
      <section aria-labelledby={`${idPrefix}-sent`} className="ih-note__form">
        <p id={`${idPrefix}-sent`} className="ih-note__fine" role="status">
          {CONTACT_REQUEST_COPY.sent}
        </p>
        {failed && <ImmersiveBanner message={CONTACT_REQUEST_COPY.withdrawFailed} />}
        <Button
          type="button"
          variant="link"
          pending={pending}
          pendingLabel={CONTACT_REQUEST_COPY.withdrawing}
          onClick={() => void onWithdraw()}
        >
          {CONTACT_REQUEST_COPY.withdraw}
        </Button>
      </section>
    )
  }

  return (
    <form
      className="ih-note__form"
      aria-labelledby={`${idPrefix}-heading`}
      onSubmit={submitHandler(form)}
      noValidate
    >
      <h3 id={`${idPrefix}-heading`} className="ih-note__label">
        {CONTACT_REQUEST_COPY.heading}
      </h3>
      <p id={`${idPrefix}-hint`} className="ih-note__fine">
        {CONTACT_REQUEST_COPY.body}
      </p>
      <form.Field name="email">
        {(field) => (
          <>
            <label className="ih-note__label" htmlFor={`${idPrefix}-email`}>
              {CONTACT_REQUEST_COPY.emailLabel}
            </label>
            <input
              id={`${idPrefix}-email`}
              className="ih-note__field"
              name={field.name}
              type="email"
              autoComplete="email"
              maxLength={254}
              value={field.state.value}
              disabled={pending}
              aria-invalid={!field.state.meta.isValid}
              aria-describedby={`${idPrefix}-hint`}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {!field.state.meta.isValid && (
              <ImmersiveBanner message={CONTACT_REQUEST_COPY.emailRequired} />
            )}
          </>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <>
            <label className="ih-note__label" htmlFor={`${idPrefix}-name`}>
              {CONTACT_REQUEST_COPY.nameLabel}
            </label>
            <input
              id={`${idPrefix}-name`}
              className="ih-note__field"
              name={field.name}
              type="text"
              autoComplete="name"
              maxLength={100}
              value={field.state.value}
              disabled={pending}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </>
        )}
      </form.Field>
      <form.Field name="consent">
        {(field) => (
          <>
            <label className="ih-note__label" htmlFor={`${idPrefix}-consent`}>
              <input
                id={`${idPrefix}-consent`}
                name={field.name}
                type="checkbox"
                checked={field.state.value}
                disabled={pending}
                aria-invalid={!field.state.meta.isValid}
                onChange={(event) => field.handleChange(event.target.checked)}
              />{' '}
              {CONTACT_REQUEST_COPY.consentLabel}
            </label>
            {!field.state.meta.isValid && (
              <ImmersiveBanner message={CONTACT_REQUEST_COPY.consentRequired} />
            )}
          </>
        )}
      </form.Field>
      {failed && <ImmersiveBanner message={CONTACT_REQUEST_COPY.sendFailed} />}
      <form.Field name="honeypot">
        {(field) => (
          <ImmersiveHoneypot
            id={`${idPrefix}-website`}
            label={CONTACT_REQUEST_COPY.honeypotLabel}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <div className="ih-note__actions">
        <Button
          type="submit"
          pending={pending}
          pendingLabel={CONTACT_REQUEST_COPY.sending}
        >
          {CONTACT_REQUEST_COPY.send}
        </Button>
      </div>
    </form>
  )
}
