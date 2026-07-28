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
      dynamicAccessControl: { enabled: true },
    }),
  ],
})

// Typed hooks re-exports for convenience.
// Owner: Identity. Documented convenience surface (E-class, BQC-5.8): routes
// import these hooks from here so authClient call-sites stay terse; each
// re-export is suppressed individually below. Review at BQC-6 close.
export const {
  // fallow-ignore-next-line unused-export
  useSession,
  // fallow-ignore-next-line unused-export
  signIn,
  // fallow-ignore-next-line unused-export
  signUp,
  // fallow-ignore-next-line unused-export
  signOut,
  // fallow-ignore-next-line unused-export
  requestPasswordReset,
  // fallow-ignore-next-line unused-export
  resetPassword,
  // fallow-ignore-next-line unused-export
  sendVerificationEmail,
} = authClient
