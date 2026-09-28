// Integration context — domain rules

import type { GoogleConnection, GoogleConnectionVisibility } from './types'

const VALID_VISIBILITIES: ReadonlySet<string> = new Set(['private', 'organization'])

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email)

export const isValidVisibility = (v: string): v is GoogleConnectionVisibility =>
  VALID_VISIBILITIES.has(v)

/**
 * A governed disconnect holds its connection in `disconnecting` from the moment
 * it may send the provider revoke until it settles; past its cleanup window the
 * recovery sweep settles it instead. While that window is open, another
 * disconnect must leave the row to the attempt, or the attempt could never
 * redact it. Once the window has closed, finishing the disconnect locally is
 * the way out for a row the attempt can no longer settle.
 */
export const isGovernedDisconnectInFlight = (
  connection: Pick<GoogleConnection, 'status' | 'cleanupMaterialDeadlineAt'>,
  now: Date,
): boolean =>
  connection.status === 'disconnecting' &&
  connection.cleanupMaterialDeadlineAt !== null &&
  connection.cleanupMaterialDeadlineAt.getTime() > now.getTime()
