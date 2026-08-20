import { useState, type FormEvent } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { GuestResponseFormView } from './guest-response-form-view'

type ResponsePayload = Readonly<{
  token: string
  csrfNonce: string
  rating: number | null
  text: string | null
  responseConsent: boolean
  textConsent: boolean
  mediaConsent: boolean
}>

type Action<TInput, TResult> = (input: { data: TInput }) => Promise<TResult>

export type GuestResponseFormProps = Readonly<{
  token: string
  csrfNonce: string
  initialResponse: GuestResponseView | null
  availability?: 'available' | 'loading' | 'permission_denied' | 'error'
  mediaEnabled?: boolean
  initialMessage?: string
  submitResponse: Action<ResponsePayload, GuestResponseView>
  correctResponse: Action<ResponsePayload, GuestResponseView>
  withdrawResponse: Action<{ token: string; csrfNonce: string }, GuestResponseView>
  issueMedia: Action<
    {
      token: string
      csrfNonce: string
      contentType: 'image/jpeg' | 'image/png' | 'image/webp'
      sizeBytes: number
    },
    {
      mediaId: string
      objectKey: string
      uploadUrl: string
      contentType: string
    }
  >
  confirmMedia: Action<
    { token: string; csrfNonce: string; mediaId: string; objectKey: string },
    { mediaId: string; status: 'ready' }
  >
}>

const allowedMediaTypes: ReadonlyArray<string> = ['image/jpeg', 'image/png', 'image/webp']
const maxMediaBytes = 10 * 1024 * 1024

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
  const [rating, setRating] = useState<number | null>(initialResponse?.rating ?? null)
  const [text, setText] = useState(initialResponse?.text ?? '')
  const [responseConsent, setResponseConsent] = useState(
    initialResponse?.responseConsent ?? false,
  )
  const [textConsent, setTextConsent] = useState(initialResponse?.textConsent ?? false)
  const [mediaConsent, setMediaConsent] = useState(initialResponse?.mediaConsent ?? false)
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState(initialMessage)

  const isCorrecting = response?.status === 'submitted'
  const isTerminal = response?.status === 'corrected' || response?.status === 'deleted'

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isTerminal) return
    if (rating == null && text.trim().length === 0) {
      setMessage('Choose a rating or enter feedback before submitting.')
      return
    }
    if (rating != null && !responseConsent) {
      setMessage('Choose whether to share the optional rating.')
      return
    }
    if (text.trim() && !textConsent) {
      setMessage('Choose whether to share the optional written feedback.')
      return
    }
    if (file && !mediaConsent) {
      setMessage('Choose whether to share the optional image.')
      return
    }

    setPending(true)
    setMessage('')
    try {
      const data: ResponsePayload = {
        token,
        csrfNonce,
        rating,
        text: text.trim() || null,
        responseConsent,
        textConsent,
        mediaConsent,
      }
      const next = isCorrecting
        ? await correctResponse({ data })
        : await submitResponse({ data })
      setResponse(next)

      if (file) {
        if (!allowedMediaTypes.includes(file.type) || file.size > maxMediaBytes) {
          throw new Error('Choose a JPEG, PNG, or WebP image up to 10 MiB.')
        }
        const issuance = await issueMedia({
          data: {
            token,
            csrfNonce,
            contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
            sizeBytes: file.size,
          },
        })
        const upload = await fetch(issuance.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': issuance.contentType },
          body: file,
        })
        if (!upload.ok) throw new Error('The image upload did not complete.')
        await confirmMedia({
          data: {
            token,
            csrfNonce,
            mediaId: issuance.mediaId,
            objectKey: issuance.objectKey,
          },
        })
      }
      setMessage(
        isCorrecting
          ? 'Your response was corrected. You can still withdraw it.'
          : 'Your optional response was submitted. You may correct it once for one hour.',
      )
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'The response could not be saved.',
      )
    } finally {
      setPending(false)
    }
  }

  const onWithdraw = async () => {
    setPending(true)
    setMessage('')
    try {
      const deleted = await withdrawResponse({ data: { token, csrfNonce } })
      setResponse(deleted)
      setRating(null)
      setText('')
      setFile(null)
      setMessage('Your response was withdrawn and its content was removed.')
    } catch {
      setMessage('The response could not be withdrawn. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <GuestResponseFormView
      availability={availability}
      mediaEnabled={mediaEnabled}
      response={response}
      rating={rating}
      text={text}
      responseConsent={responseConsent}
      textConsent={textConsent}
      mediaConsent={mediaConsent}
      pending={pending}
      message={message}
      isCorrecting={isCorrecting}
      isTerminal={isTerminal}
      onSubmit={onSubmit}
      onWithdraw={() => void onWithdraw()}
      onRatingChange={setRating}
      onTextChange={setText}
      onResponseConsentChange={setResponseConsent}
      onTextConsentChange={setTextConsent}
      onMediaConsentChange={setMediaConsent}
      onFileChange={setFile}
    />
  )
}
