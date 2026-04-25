// Better Auth client configuration
import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { ac, owner, admin, memberRole } from './permissions'

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      ac,
      roles: {
        owner,
        admin,
        member: memberRole,
      },
    }),
  ],
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
