// Identity context — what an acceptance could not grant.
//
// The command store grants an invitation's Properties in the acceptance
// transaction and names the ones it could not. Every acceptance path (signed
// in, registration, recovery) reports them the same way.

import type { InvitationAcceptance } from './ports/identity-command-store.port'

type ErrorLogger = Readonly<{ error: (obj: object, message?: string) => void }>

/** What ties the line to its acceptance where no request does. */
type AcceptanceCorrelation = Readonly<{ registrationVerificationId?: string }>

/**
 * An invited Property that was not granted is logged, never silent: the
 * manager has fewer Properties than the invitation promised. Counts only —
 * tenant identifiers are never log fields (BQC-7.3). On a request its
 * correlation fields tie the line to the acceptance; the recovery job has no
 * request, so it names its registration record, as its other lines do.
 */
export function reportUngrantedInvitedProperties(
  logger: ErrorLogger,
  acceptance: InvitationAcceptance,
  correlation: AcceptanceCorrelation = {},
): void {
  if (acceptance.ungrantedPropertyIds.length === 0) return
  logger.error(
    {
      ...correlation,
      failedPropertyCount: acceptance.ungrantedPropertyIds.length,
      requestedPropertyCount: acceptance.propertyIds.length,
    },
    'Invited property access was only partly provisioned',
  )
}
