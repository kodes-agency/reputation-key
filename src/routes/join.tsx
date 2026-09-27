// Join page — creates a beta manager account from one exact invitation.
// The server-side saga consumes the invitation atomically; success asks the
// user to sign in so session creation remains a separate explicit action.
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getSession } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { RegisterForm } from '#/components/features/identity'
import { registerMember } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'

/**
 * The link names one invitation. Anything the router parsed into something else
 * (a repeated key's array, a number, `true`, an empty value) reads as no
 * invitation: the Invitation required card. Non-empty string, as the server's
 * registerMemberInputSchema takes it.
 */
export const joinSearch = z.object({
  invitationId: z.string().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/join')({
  validateSearch: joinSearch,
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/properties' })
    }
  },
  component: JoinPage,
})

function JoinPage() {
  const { invitationId } = Route.useSearch()
  const register = useAction(useServerFn(registerMember))

  const mutation = wrapAction(register, async () => undefined)

  if (!invitationId) {
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
      <RegisterForm mode="join" mutation={mutation} invitationId={invitationId} />
      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        By joining you accept the{' '}
        <Link
          to="/privacy/beta-agreement"
          className="font-medium text-link underline underline-offset-4"
        >
          Beta Agreement
        </Link>{' '}
        and the{' '}
        <Link
          to="/privacy"
          className="font-medium text-link underline underline-offset-4"
        >
          Privacy Notice
        </Link>
        .
      </p>
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
