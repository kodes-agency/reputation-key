// Tagged AuthError taxonomy + HTTP status mapping.
// Shared by the auth middleware (requireAuth) and the tenant resolver so both
// throw the same ServerFunctionError shape without importing each other.

import { match } from 'ts-pattern'
import { throwContextError } from './server-errors'

export type AuthErrorCode =
  | 'unauthorized'
  | 'session_expired'
  | 'forbidden'
  | 'no_active_org'
  | 'organization_binding_conflict'
  | 'authorization_unavailable'

export type AuthError = Readonly<{
  _tag: 'AuthError'
  code: AuthErrorCode
  message: string
}>

const authErrorStatus = (code: AuthErrorCode): number =>
  match(code)
    .with('unauthorized', 'session_expired', () => 401)
    .with('forbidden', () => 403)
    .with('no_active_org', () => 400)
    .with('organization_binding_conflict', () => 409)
    .with('authorization_unavailable', () => 503)
    .exhaustive()

export function throwAuthError(code: AuthErrorCode, message: string): never {
  throwContextError('AuthError', { code, message }, authErrorStatus(code))
}
