// The write of one reply to Google. The integration adapter throws the
// provider's own failure; this use case turns it into the Review error the
// publish job classifies, and decides when a refusal is the reconnect case.

import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  executorErrorToReviewApiError,
  isProviderCallFailure,
  reviewApiError,
} from '../google-review-api-error'
import type {
  GoogleConnectionStatusPort,
  GoogleReplyPublicationRequest,
  GoogleReplyPublicationResult,
  GoogleReviewApiError,
  GoogleReviewApiPort,
} from '../ports/google-review-api.port'

export type PublishReplyToGoogleDeps = Readonly<{
  googleReviewApi: Pick<GoogleReviewApiPort, 'replyToReview'>
  connectionStatus: GoogleConnectionStatusPort
  logger: Pick<LoggerPort, 'warn'>
}>

export type PublishReplyToGoogle = (
  input: GoogleReplyPublicationRequest,
) => Promise<GoogleReplyPublicationResult>

/**
 * A reply refused while its connection waits for an AccountAdmin to reconnect
 * Google is the reconnect case, not a changed approval, so the publish job can
 * tell its author so. An unreadable connection keeps the refusal as it was;
 * both codes are terminal.
 */
async function withReauthorizationCause(
  deps: PublishReplyToGoogleDeps,
  input: GoogleReplyPublicationRequest,
  refusal: GoogleReviewApiError,
): Promise<GoogleReviewApiError> {
  if (refusal.code !== 'authorization_changed') return refusal
  let status: string | null
  try {
    status = await deps.connectionStatus.findStatus(
      input.organizationId,
      input.connectionId,
    )
  } catch {
    deps.logger.warn(
      { event: 'google_reply_refusal_connection_unreadable' },
      'Google reply refusal kept its code; the connection could not be read',
    )
    return refusal
  }
  if (status !== 'reauth_required') return refusal
  return reviewApiError(
    'reauthorization_required',
    false,
    refusal.failure === undefined ? {} : { failure: refusal.failure },
  )
}

export const publishReplyToGoogle =
  (deps: PublishReplyToGoogleDeps): PublishReplyToGoogle =>
  async (input) => {
    try {
      return await deps.googleReviewApi.replyToReview(input)
    } catch (error) {
      // Anything that is not a provider failure (a process with no provider, a
      // fault in the job's own world) keeps its own identity.
      if (!isProviderCallFailure(error)) throw error
      throw await withReauthorizationCause(
        deps,
        input,
        executorErrorToReviewApiError(error),
      )
    }
  }
