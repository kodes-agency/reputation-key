import { queryOptions } from '@tanstack/react-query'
import { listOutstandingResponsibilitiesFn } from '#/contexts/identity/server/organization-leave-fns'
import { identityKeys } from '#/shared/queries/query-keys'

/**
 * LIF-01-T21: the transfer worklist a departing member must clear. Read
 * separately from the member list because it is about the CALLER, not about
 * the directory, and it must be fresh at the moment they open the dialog.
 *
 * `enabled` is Identity's `selfServiceLeaveAvailable` composition fact. Where
 * no responsibility facts are composed the read is fenced by design and can
 * only fail, so it is not issued at all. `retry: false` because a failed read
 * is not transient noise to retry through: the dialog shows it at once as an
 * unknown worklist and refuses the leave.
 */
export const outstandingResponsibilitiesQuery = (selfServiceLeaveAvailable: boolean) =>
  queryOptions({
    queryKey: identityKeys.outstandingResponsibilities(),
    queryFn: () => listOutstandingResponsibilitiesFn(),
    staleTime: 0,
    retry: false,
    enabled: selfServiceLeaveAvailable,
  })
