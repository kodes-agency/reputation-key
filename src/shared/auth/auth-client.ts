// Better Auth client configuration
import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [organizationClient()],
})

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
