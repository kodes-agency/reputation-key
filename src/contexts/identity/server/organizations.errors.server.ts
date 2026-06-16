// Server-only error thrower for the identity context.
//
// throwIdentityError needs throwContextError (server-only). It is split into
// this *.server.ts file so organizations.shared.ts stays client-safe — the
// shared file is loaded by the client module graph (it defines error-status
// mapping and types used across server-fn barrels). In practice the RPC
// transform strips this import too (throwIdentityError is only called inside
// server-fn handler bodies); the *.server.ts naming is defense-in-depth.

import { throwContextError } from '#/shared/auth/server-errors'
import { identityErrorStatus } from './organizations.shared'
import type { IdentityError } from '../domain/errors'

/** Throw a tagged IdentityError as an Error object (not Response).
 * Per architecture: "Server functions throw Error objects with .name, .message, .code, .status." */
export function throwIdentityError(e: IdentityError): never {
  throwContextError('IdentityError', e, identityErrorStatus(e.code))
}
