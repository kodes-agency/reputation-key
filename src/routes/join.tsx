// Join page — creates a beta manager account from one exact invitation.
// `beforeLoad` reads the invitation first: an address that already has an
// account goes to sign in, a signed-in visitor to the confirm step, and a link
// that is expired, cancelled, used or unknown says so instead of offering a
// form. For a usable one the page shows what is being joined and locks the
// invited address. The server-side saga consumes the invitation atomically,
// which verifies the address, and then signs the new member in; the page lands
// them in the app the way a sign-in does. If that sign-in failed, the card asks
// them to sign in.
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { ensureActiveOrg } from '#/shared/auth/auth.functions'
import { INVITATION_ID_MAX_LENGTH } from '#/shared/domain/ids'
import { clearTenantCacheBeforeNavigation } from '#/shared/queries/tenant-cache-transition'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import {
  InvitationLinkStateCard,
  InvitationSummary,
  RegisterForm,
} from '#/components/features/identity'
import { JoinEntryCard } from '#/components/features/identity/registration/join-entry-card'
import { registerMember } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'
import { InlineLink } from '#/components/ui/inline-link'
import { enterWorkspace } from './-join-entry'

/**
 * The link names one invitation. Anything the router parsed into something else
 * (a repeated key's array, a number, `true`, an empty value) or longer than an
 * id the preview accepts reads as no invitation: the Invitation required card.
 * Non-empty string, as the server's registerMemberInputSchema takes it.
 */
export const joinSearch = z.object({
  invitationId: z
    .string()
    .min(1)
    .max(INVITATION_ID_MAX_LENGTH)
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/join')({
  validateSearch: joinSearch,
  beforeLoad: async ({ search }) => {
    // Loaded on demand: first-paint bytes are budgeted, and this only runs for
    // a visitor who opened an invitation link.
    const entry = await import('./-invitation-entry')
    return entry.resolveJoinLink(search.invitationId)
  },
  component: JoinPage,
})

function JoinPage() {
  const { link } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const register = useAction(useServerFn(registerMember))
  // The session cookie is already set once registration returns, so a failed
  // follow-up has no form to land its error in: `enter` keeps it for the card.
  const enter = useAction(() =>
    enterWorkspace({
      ensureActiveOrg,
      // /join never held an authenticated match, and the _authenticated layout
      // re-reads the session on navigation, so no whole-router invalidation.
      navigateToWorkspace: () =>
        clearTenantCacheBeforeNavigation(queryClient, () =>
          navigate({ to: '/properties' }),
        ),
    }),
  )
  const retryEnter = () => void enter(undefined).catch(() => undefined)

  const mutation = wrapAction(register, async ({ signedIn }) => {
    if (signedIn) await enter(undefined).catch(() => undefined)
  })

  if (link === null) {
    return (
      <AuthCard
        title="Invitation required"
        description="Beta accounts are created from a manager invitation."
      >
        <div className="text-center">
          <InlineLink to="/login" className="text-sm">
            Sign in to an existing account
          </InlineLink>
        </div>
      </AuthCard>
    )
  }

  if (link.state !== 'pending') return <InvitationLinkStateCard link={link} />

  if (mutation.isSuccess && mutation.data?.signedIn === true) {
    return (
      <JoinEntryCard status={enter.error ? 'failed' : 'entering'} onRetry={retryEnter} />
    )
  }

  if (mutation.isSuccess) {
    return (
      <AuthCard
        title="Account created!"
        description="Your account is ready. Sign in to get started."
      >
        <div className="text-center">
          <InlineLink to="/login" className="text-sm">
            Sign in to your account
          </InlineLink>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      description={`Join ${link.details.organizationName} on Reputation Key`}
    >
      <div className="space-y-4">
        <InvitationSummary invitation={link.details} />
        <RegisterForm
          mode="join"
          mutation={mutation}
          invitationId={link.invitationId}
          lockedEmail={link.invitedEmail}
        />
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        By joining you accept the{' '}
        <InlineLink to="/privacy/beta-agreement" underline="always">
          Beta Agreement
        </InlineLink>{' '}
        and the{' '}
        <InlineLink to="/privacy" underline="always">
          Privacy Notice
        </InlineLink>
        .
      </p>
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
