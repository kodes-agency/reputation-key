// Better Auth client configuration
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()

// Typed hooks re-exports for convenience
export const {
  useSession,
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient
