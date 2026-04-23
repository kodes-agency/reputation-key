// Auth barrel — re-exports all auth-related modules
// Per conventions: "Wait for the second importer before adding to shared/"
// Individual imports are also fine — this barrel exists for convenience.
export { getAuth, createAuth } from './auth'
export type { AuthUser } from './auth'
export {
  getUserFromHeaders,
  getSessionFromHeaders,
  requireAuth,
  resolveTenantContext,
  roleGuard,
} from './middleware'
export type { AuthError } from './middleware'
export { headersFromContext } from './headers'
export { authClient, useSession } from './auth-client'
export {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendInvitationEmail,
  getResend,
} from './emails'
export type { AuthContext } from '#/shared/domain/auth-context'
