import { useQueryClient } from '@tanstack/react-query'
import { authClient } from '#/shared/auth/auth-client'
import { clearTenantCacheAfterSessionEnd } from '#/shared/queries/tenant-cache-transition'
import { useActionMutation } from './use-action-mutation'

type Options = Readonly<{
  onSignedOut?: () => unknown | Promise<unknown>
  /** Invitation forms report through their existing error banner. */
  feedback?: 'toast' | 'inline'
}>

/**
 * Ends the session, then forgets the tenant's cache and calls `onSignedOut`. The
 * auth client reports a refusal (429, 500) or a lost request as a result, not a
 * throw, so it is read here: a failed sign-out leaves the session, the caches and
 * the page as they were and says so, and the same call can be made again.
 * A menu item reports through a toast; `inline` leaves the report to the caller's
 * banner.
 */
export function useSignOut({ onSignedOut, feedback = 'toast' }: Options = {}) {
  const queryClient = useQueryClient()
  return useActionMutation<void, void>(
    async () =>
      clearTenantCacheAfterSessionEnd(
        queryClient,
        async () => {
          const result = await authClient.signOut()
          if (result.error) throw new Error('Could not sign out. Please try again.')
        },
        onSignedOut,
      ),
    {
      errorMessage:
        feedback === 'toast' ? 'Could not sign out. Please try again.' : undefined,
    },
  )
}
