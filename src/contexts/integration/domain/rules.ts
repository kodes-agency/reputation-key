// Integration context — domain rules

import type { GoogleConnection, GoogleConnectionVisibility } from './types'
import { integrationError } from './errors'

const VALID_VISIBILITIES: ReadonlySet<string> = new Set(['private', 'organization'])

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email)

export const isValidVisibility = (v: string): v is GoogleConnectionVisibility =>
  VALID_VISIBILITIES.has(v)

type DisconnectAuthority = Pick<GoogleConnection, 'status' | 'lifecycleVersion'>

/** Cleanup retries must leave a connection that has since reconnected untouched. */
export function assertGoogleDisconnectAuthority(
  connection: DisconnectAuthority | null | undefined,
  cleanupLifecycleVersion: number | undefined,
): asserts connection is DisconnectAuthority {
  if (!connection) {
    throw integrationError('connection_not_found', 'Google connection not found')
  }
  if (
    cleanupLifecycleVersion !== undefined &&
    (connection.status !== 'disconnected' ||
      connection.lifecycleVersion !== cleanupLifecycleVersion)
  ) {
    throw integrationError('invalid_transition', 'Google connection authority changed')
  }
}

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
