import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
import { reviewApiError } from './google-review-api-error'
import type {
  GoogleConnectionStatusPort,
  GoogleReviewApiError,
} from './ports/google-review-api.port'

/**
 * A Google call refused while its connection waits for an AccountAdmin to
 * reconnect Google is the reconnect case, not a changed approval, so the
 * publish job can tell its author so. An unreadable connection keeps the
 * refusal as it was; both codes are terminal.
 */
export async function withReauthorizationCause(
  deps: Readonly<{
    connectionStatus: GoogleConnectionStatusPort
    logger: Pick<LoggerPort, 'warn'>
  }>,
  scope: Readonly<{ organizationId: OrganizationId; connectionId: GoogleConnectionId }>,
  refusal: GoogleReviewApiError,
): Promise<GoogleReviewApiError> {
  if (refusal.code !== 'authorization_changed') return refusal
  let status: string | null
  try {
    status = await deps.connectionStatus.findStatus(
      scope.organizationId,
      scope.connectionId,
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
