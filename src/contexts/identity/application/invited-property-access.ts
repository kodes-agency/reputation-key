// Identity context — what an acceptance could not grant.
//
// The command store grants an invitation's Properties in the acceptance
// transaction and names the ones it could not. Every acceptance path (signed
// in, registration, recovery) reports them the same way.

import type { InvitationAcceptance } from './ports/identity-command-store.port'

type ErrorLogger = Readonly<{ error: (obj: object, message?: string) => void }>

/**
 * An invited Property that was not granted is logged, never silent: the
 * manager has fewer Properties than the invitation promised. Counts only —
 * tenant identifiers are never log fields (BQC-7.3); the request's correlation
 * fields tie the line to the acceptance.
 */
export function reportUngrantedInvitedProperties(
  logger: ErrorLogger,
  acceptance: InvitationAcceptance,
): void {
  if (acceptance.ungrantedPropertyIds.length === 0) return
  logger.error(
    {
      failedPropertyCount: acceptance.ungrantedPropertyIds.length,
      requestedPropertyCount: acceptance.propertyIds.length,
    },
    'Invited property access was only partly provisioned',
  )
}
