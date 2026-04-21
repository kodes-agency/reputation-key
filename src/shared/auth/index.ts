// Auth barrel — re-exports all auth-related modules
// Per conventions: "Wait for the second importer before adding to shared/"
// Individual imports are also fine — this barrel exists for convenience.
export { getAuth, createAuth } from './auth'
export type { AuthUser } from './auth'
export {
  getUserFromHeaders,
  getSessionFromHeaders,
  requireAuth,
  requireRole,
} from './middleware'
export type { AuthError } from './middleware'
export { authClient, useSession } from './auth-client'
export { sendVerificationEmail, sendResetPasswordEmail, getResend } from './emails'
export type { AuthContext, Role } from './context'
export { ROLE_HIERARCHY, hasRole } from './context'
