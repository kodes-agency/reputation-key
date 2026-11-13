// The write of one reply to Google. The integration adapter throws the
// provider's own failure; this use case turns it into the Review error the
// publish job classifies, and decides when a refusal is the reconnect case.

import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  executorErrorToReviewApiError,
  isProviderCallFailure,
} from '../google-review-api-error'
import { withReauthorizationCause } from '../reauthorization-cause'
import type {
  GoogleConnectionStatusPort,
  GoogleReplyPublicationRequest,
  GoogleReplyPublicationResult,
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
