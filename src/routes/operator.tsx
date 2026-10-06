// Platform operator console (ADR 0065): the owner creates each Organization,
// without joining it, and hands it to its first Account Admin.
//
// It sits OUTSIDE `_authenticated` because the operator holds no role in the
// Organizations it lists, so the tenant shell has nothing to resolve for it.
// `beforeLoad` only asks for a session; who is an operator is the server's
// answer (the loader's read, and every mutation, re-check it). A signed-in
// user who is not an operator gets Not Found, so the console is not advertised.

import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { OperatorConsolePage } from '#/components/features/platform'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import {
  cancelOrganizationAdminInvitationFn,
  inviteOrganizationAdminFn,
  provisionOrganizationFn,
  resendOrganizationAdminInvitationFn,
} from '#/contexts/identity/server/platform-console-changes'
import { listPlatformOrganizationsFn } from '#/contexts/identity/server/platform-console'
import { getSession } from '#/shared/auth/auth.functions'
import { authClient } from '#/shared/auth/auth-client'
import { platformKeys } from '#/shared/queries/query-keys'
import { clearTenantCacheAfterSessionEnd } from '#/shared/queries/tenant-cache-transition'
import { httpStatus } from '#/shared/security/expected-refusal'

export const platformOrganizationsQuery = queryOptions({
  queryKey: platformKeys.organizations(),
  queryFn: () => listPlatformOrganizationsFn(),
  staleTime: 30_000,
})

export const Route = createFileRoute('/operator')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  loader: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(platformOrganizationsQuery)
    } catch (error) {
      // Not an operator (their account is not on the list): the
      // route does not exist for them. Any other failure is shown as itself.
      if (httpStatus(error) === 403) throw notFound()
      throw error
    }
  },
  component: OperatorRoute,
})

const INVITATION_EMAIL_UNSENT =
  'Invitation created, but the email could not be sent. Use Resend.'
const RENEWAL_EMAIL_UNSENT =
  'Invitation renewed, but the email could not be sent. Try Resend again.'

const refreshOrganizations = [platformKeys.organizations()]

function OperatorRoute() {
  const { data: organizations } = useSuspenseQuery(platformOrganizationsQuery)
  const router = useRouter()
  const queryClient = useQueryClient()

  // The create dialog and each invite form show their own refusal beside the
  // field it came from, so provision and inviteAdmin do not also toast it. The
  // invitation lines have no inline error surface: a refusal (the change
  // budget, an invitation already gone) is reported by toast.
  const provision = useActionMutation(provisionOrganizationFn, {
    invalidateKeys: refreshOrganizations,
  })
  const inviteAdmin = useActionMutation(inviteOrganizationAdminFn, {
    invalidateKeys: refreshOrganizations,
    onSuccess: ({ emailSent }) => {
      // The invitation exists either way; an unsent email is renewed by Resend.
      if (emailSent) toast.success('Invitation sent')
      else toast.warning(INVITATION_EMAIL_UNSENT)
    },
  })
  const resend = useActionMutation(resendOrganizationAdminInvitationFn, {
    errorMessage: actionErrorMessage,
    invalidateKeys: refreshOrganizations,
    onSuccess: ({ emailSent }) => {
      if (emailSent) toast.success('Invitation resent')
      else toast.warning(RENEWAL_EMAIL_UNSENT)
    },
  })
  // Confirmed in a dialog that stays open and says a refusal itself.
  const cancel = useActionMutation(cancelOrganizationAdminInvitationFn, {
    successMessage: 'Invitation cancelled',
    invalidateKeys: refreshOrganizations,
  })

  // A change needs a sign-in from the last 30 minutes: end this session, sign
  // in again, and land back here with the same list.
  const signInAgain = () => {
    void clearTenantCacheAfterSessionEnd(
      queryClient,
      () => authClient.signOut(),
      () => router.navigate({ to: '/login', search: { redirect: '/operator' } }),
    ).catch(() => toast.error('Could not sign you out. Try again.'))
  }

  return (
    <OperatorConsolePage
      organizations={organizations}
      actions={{ provision, inviteAdmin, resend, cancel }}
      onSignInAgain={signInAgain}
    />
  )
}
