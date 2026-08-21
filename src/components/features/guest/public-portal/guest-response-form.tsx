import { useState, type FormEvent } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { GuestResponseFormView } from './guest-response-form-view'
import {
  selectGuestMedia,
  type ConfirmGuestMediaAction,
  type IssueGuestMediaAction,
  type SelectedMedia,
} from './guest-media'
import {
  guestDraftBlockReason,
  guestMediaSelectionMessage,
  guestResponseDraft,
  guestResponsePhase,
  guestWithdrawErrorMessage,
  guestWithdrawSuccessMessage,
  type GuestResponseDraft,
} from './guest-response-labels'
import {
  saveGuestResponse,
  type GuestResponseAction,
  type GuestResponsePayload,
} from './guest-response-save'

export type GuestResponseFormProps = Readonly<{
  token: string
  csrfNonce: string
  initialResponse: GuestResponseView | null
  availability?: 'available' | 'loading' | 'permission_denied' | 'error'
  mediaEnabled?: boolean
  initialMessage?: string
  submitResponse: GuestResponseAction<GuestResponsePayload, GuestResponseView>
  correctResponse: GuestResponseAction<GuestResponsePayload, GuestResponseView>
  withdrawResponse: GuestResponseAction<
    { token: string; csrfNonce: string },
    GuestResponseView
  >
  issueMedia: IssueGuestMediaAction
  confirmMedia: ConfirmGuestMediaAction
}>

/**
 * State and effects for the guest response form; every decision it makes lives in
 * `guest-response-labels` (what the guest is told, and whether the draft may go)
 * or `guest-response-save` (the write, and the ordering the image upload needs).
 * What is left here is the ten pieces of state and the three things a guest can
 * do to them, so each handler reads as a straight sequence.
 */
export function GuestResponseForm({
  token,
  csrfNonce,
  initialResponse,
  availability = 'available',
  mediaEnabled = true,
  initialMessage = '',
  submitResponse,
  correctResponse,
  withdrawResponse,
  issueMedia,
  confirmMedia,
}: GuestResponseFormProps) {
  const [response, setResponse] = useState(initialResponse)
  const [draft, setDraft] = useState(() => guestResponseDraft(initialResponse))
  const [media, setMedia] = useState<SelectedMedia | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState(initialMessage)
  const [honeypot, setHoneypot] = useState('')

  const { isCorrecting, isTerminal } = guestResponsePhase(response)

  /** Every field edit is one of these, so they cannot drift out of step. */
  const edit = (change: Partial<GuestResponseDraft>) =>
    setDraft((current) => ({ ...current, ...change }))

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isTerminal) return

    const blocked = guestDraftBlockReason(draft, media !== null)
    if (blocked !== null) {
      setMessage(blocked)
      return
    }

    setPending(true)
    setMessage('')
    setMessage(
      await saveGuestResponse({
        draft,
        media,
        token,
        csrfNonce,
        honeypot,
        isCorrecting,
        submitResponse,
        correctResponse,
        issueMedia,
        confirmMedia,
        onWritten: setResponse,
      }),
    )
    setPending(false)
  }

  const onWithdraw = async () => {
    setPending(true)
    setMessage('')
    try {
      setResponse(await withdrawResponse({ data: { token, csrfNonce } }))
      edit({ rating: null, text: '' })
      setMedia(null)
      setMessage(guestWithdrawSuccessMessage)
    } catch {
      setMessage(guestWithdrawErrorMessage)
    }
    setPending(false)
  }

  /** Media is checked here, at selection — never after the response is written. See
   *  `guest-media` for why that ordering mattered. */
  const onFileChange = (next: File | null) => {
    const selected = next === null ? null : selectGuestMedia(next)
    setMedia(selected)
    setMessage(guestMediaSelectionMessage(next !== null && selected === null, message))
  }

  return (
    <GuestResponseFormView
      availability={availability}
      mediaEnabled={mediaEnabled}
      response={response}
      rating={draft.rating}
      text={draft.text}
      responseConsent={draft.responseConsent}
      textConsent={draft.textConsent}
      mediaConsent={draft.mediaConsent}
      pending={pending}
      message={message}
      honeypot={honeypot}
      isCorrecting={isCorrecting}
      isTerminal={isTerminal}
      onSubmit={onSubmit}
      onWithdraw={() => void onWithdraw()}
      onRatingChange={(rating) => edit({ rating })}
      onTextChange={(text) => edit({ text })}
      onResponseConsentChange={(responseConsent) => edit({ responseConsent })}
      onTextConsentChange={(textConsent) => edit({ textConsent })}
      onMediaConsentChange={(mediaConsent) => edit({ mediaConsent })}
      onHoneypotChange={setHoneypot}
      onFileChange={onFileChange}
    />
  )
}
