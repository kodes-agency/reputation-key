import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { invalidateShellContext } from '#/shared/queries/shell-context-cache'
import { httpStatus } from '#/shared/security/expected-refusal'
export function watchStaffRefusals(client: QueryClient, leave: () => void) {
  return client.getQueryCache().subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'error' ||
      event.query.queryKey[0] !== 'staff-self'
    )
      return
    if (![400, 401, 403, 404].includes(httpStatus(event.action.error) ?? 0)) return
    client.removeQueries({ predicate: (query) => query.queryKey[0] === 'staff-self' })
    invalidateShellContext(client)
    leave()
  })
}
export function useStaffRefusal() {
  const client = useQueryClient()
  const router = useRouter()
  useEffect(
    () =>
      watchStaffRefusals(client, () => {
        void router.invalidate({
          filter: (match) =>
            match.routeId === '/my' || match.routeId === '/_authenticated/my-code',
        })
      }),
    [client, router],
  )
}
