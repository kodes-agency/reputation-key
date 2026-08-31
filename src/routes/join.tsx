// Join page — creates a beta manager account from one exact invitation.
// The server-side saga consumes the invitation atomically; success asks the
// user to sign in so session creation remains a separate explicit action.
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSession } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { RegisterForm } from '#/components/features/identity'
import { registerMember } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/join')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: JoinPage,
})

function JoinPage() {
  const search = Route.useSearch() as { invitationId?: string }
  const register = useAction(useServerFn(registerMember))

  const mutation = wrapAction(register, async () => undefined)

  if (!search.invitationId) {
    return (
      <AuthCard
        title="Invitation required"
        description="Beta accounts are created from a manager invitation."
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Sign in to an existing account
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (mutation.isSuccess) {
    return (
      <AuthCard
        title="Account created!"
        description="Your account is ready. Sign in to get started."
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Sign in to your account
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" description="Join your team on Reputation Key">
      <RegisterForm mode="join" mutation={mutation} invitationId={search.invitationId} />
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
