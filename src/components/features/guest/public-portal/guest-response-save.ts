/**
 * The write half of the guest response form: turning a draft into a persisted
 * response, and turning whatever happened into the one sentence the guest reads.
 *
 * Separated from `guest-response-form.tsx` so that component holds state and
 * nothing else. The two sequencing rules below are the reason this is a module
 * and not an inline handler:
 *
 *  - the response is adopted the moment the write returns, *before* the optional
 *    image is uploaded, because at that point it is already persisted — a form
 *    that waited for the upload would leave the guest looking at a form for a
 *    response that already exists, and a retry would spend their one correction;
 *  - a failed upload therefore reports an error over an adopted response, not
 *    instead of one.
 */

import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import {
  uploadGuestMedia,
  type ConfirmGuestMediaAction,
  type IssueGuestMediaAction,
  type SelectedMedia,
} from './guest-media'
import {
  guestSaveErrorMessage,
  guestSaveSuccessMessage,
  type GuestResponseDraft,
} from './guest-response-labels'

/** What the server boundary is sent. Blank written feedback is absent, not empty. */
export type GuestResponsePayload = Readonly<{
  token: string
  csrfNonce: string
  rating: number | null
  text: string | null
  responseConsent: boolean
  textConsent: boolean
  mediaConsent: boolean
  honeypot: string
}>

/** A TanStack server function as the form consumes it. */
export type GuestResponseAction<TInput, TResult> = (input: {
  data: TInput
}) => Promise<TResult>

export type GuestResponseSaveInput = Readonly<{
  draft: GuestResponseDraft
  media: SelectedMedia | null
  token: string
  csrfNonce: string
  honeypot: string
  /** Correcting routes the draft to `correctResponse`, and picks the outcome copy. */
  isCorrecting: boolean
  submitResponse: GuestResponseAction<GuestResponsePayload, GuestResponseView>
  correctResponse: GuestResponseAction<GuestResponsePayload, GuestResponseView>
  issueMedia: IssueGuestMediaAction
  confirmMedia: ConfirmGuestMediaAction
  /**
   * Called with the persisted response as soon as the write lands, before any
   * image upload — see the ordering rule at the top of this module.
   */
  onWritten: (response: GuestResponseView) => void
}>

/**
 * Writes the draft, then its optional image.
 *
 * @returns the sentence to show the guest: the outcome copy on success, or the
 * failure copy — which may describe a failed image upload of a response that
 * `onWritten` has already reported as persisted.
 */
export async function saveGuestResponse(input: GuestResponseSaveInput): Promise<string> {
  const { draft, media, token, csrfNonce, isCorrecting } = input
  const data: GuestResponsePayload = {
    token,
    csrfNonce,
    rating: draft.rating,
    text: draft.text.trim() || null,
    responseConsent: draft.responseConsent,
    textConsent: draft.textConsent,
    mediaConsent: draft.mediaConsent,
    honeypot: input.honeypot,
  }
  const write = isCorrecting ? input.correctResponse : input.submitResponse

  try {
    input.onWritten(await write({ data }))
    if (media !== null) {
      await uploadGuestMedia({
        media,
        token,
        csrfNonce,
        issueMedia: input.issueMedia,
        confirmMedia: input.confirmMedia,
      })
    }
    return guestSaveSuccessMessage(isCorrecting)
  } catch (error) {
    return guestSaveErrorMessage(error)
  }
}
