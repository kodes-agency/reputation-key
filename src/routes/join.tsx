// Join page — creates a beta manager account from one exact invitation.
// The server-side saga consumes the invitation atomically, which verifies the
// address, and then signs the new member in; the page lands them in the app
// the way a sign-in does. If that sign-in failed, the card asks them to sign in.
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { ensureActiveOrg, getSession } from '#/shared/auth/auth.functions'
import { clearTenantCacheBeforeNavigation } from '#/shared/queries/tenant-cache-transition'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const register = useAction(useServerFn(registerMember))

  const mutation = wrapAction(register, async ({ signedIn }) => {
    if (!signedIn) return
    await ensureActiveOrg()
    // /join never held an authenticated match, and the _authenticated layout
    // re-reads the session on navigation, so no whole-router invalidation.
    await clearTenantCacheBeforeNavigation(queryClient, () =>
      navigate({ to: '/properties' }),
    )
  })

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

  // The session cookie is already set here. If the follow-up (ensureActiveOrg
  // or the navigation) fails, its error has no mounted form to land in, so the
  // card must never be a dead end: the link is the manual way into the app.
  if (mutation.isSuccess && mutation.data?.signedIn === true) {
    return (
      <AuthCard title="Account created!" description="Your email is verified.">
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground" role="status">
            Signing you in…
          </p>
          <Link
            to="/properties"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Continue to your workspace
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
