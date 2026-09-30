// The signed-in list of pending invitations at /accept-invitation (no `?id=`).
//
// Its own module so the route file keeps none of it: the route file's
// non-component code is in the first-paint bundle, which is budgeted to the
// byte, and this is only read for a signed-in visitor on the list. `beforeLoad`
// primes it (through `-invitation-entry`, loaded on demand) and the page reads
// the same options, so the primed cache is hit with no second fetch. The
// filter and map live in the queryFn so the cached value is the list the page
// shows.

import { queryOptions } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'
import { listUserInvitations } from '#/contexts/identity/server/organizations'

export const pendingInvitationsQuery = queryOptions({
  queryKey: identityKeys.userInvitations(),
  queryFn: async () => {
    const { invitations } = await listUserInvitations()
    return invitations
      .filter((inv) => inv.status === 'pending')
      .map((inv) => ({
        id: inv.id,
        organizationName: inv.organizationName ?? 'Unknown Organization',
        role: inv.role ?? inv.rawRole,
        expiresAt: inv.expiresAt,
      }))
  },
  staleTime: 30_000,
})
