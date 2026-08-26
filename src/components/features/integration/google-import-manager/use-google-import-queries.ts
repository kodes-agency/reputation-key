import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  listImportAccounts,
  listImportCandidates,
  renewImportAuthorizationLease,
} from '#/contexts/integration/server/gbp-import'
import { integrationKeys } from '#/shared/queries/query-keys'
import { usePageVisibleAndFocused } from '#/components/hooks/use-page-visible-and-focused'

const CONTENT_LEASE_POLL_MS = 10_000

type AwaitedReturn<T extends (...args: never[]) => unknown> = Awaited<
  globalThis.ReturnType<T>
>
type AccountsPage = AwaitedReturn<typeof listImportAccounts>
type CandidatesPage = AwaitedReturn<typeof listImportCandidates>
type EpochGuard = <T>(epoch: number, operation: Promise<T>) => Promise<T>

export function useGoogleImportAccounts(
  input: Readonly<{
    organizationId: string
    enabled: boolean
    connectionId: string | null
    listAccounts: typeof listImportAccounts
    epoch: number
    guard: EpochGuard
  }>,
) {
  return useInfiniteQuery({
    queryKey: integrationKeys.googleImportAccounts(
      input.organizationId,
      input.connectionId ?? 'none',
      input.epoch,
    ),
    queryFn: ({ pageParam }) =>
      input.guard(
        input.epoch,
        input.listAccounts({
          data: {
            connectionId: input.connectionId!,
            ...(pageParam ? { cursorRef: pageParam } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AccountsPage) => lastPage.nextCursor ?? undefined,
    enabled: input.enabled && input.connectionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googleImportViewEpoch: input.epoch },
  })
}

export function useGoogleImportCandidates(
  input: Readonly<{
    organizationId: string
    connectionId: string | null
    enabled: boolean
    accountRef: string | null
    listCandidates: typeof listImportCandidates
    epoch: number
    guard: EpochGuard
  }>,
) {
  return useInfiniteQuery({
    queryKey: integrationKeys.googleImportCandidates(
      input.organizationId,
      input.connectionId ?? 'none',
      input.accountRef,
      input.epoch,
    ),
    queryFn: ({ pageParam }) =>
      input.guard(
        input.epoch,
        input.listCandidates({
          data: pageParam
            ? {
                connectionId: input.connectionId!,
                cursorRef: pageParam,
              }
            : {
                connectionId: input.connectionId!,
                accountRef: input.accountRef!,
              },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: CandidatesPage) => lastPage.nextCursor ?? undefined,
    enabled: input.enabled && input.connectionId !== null && input.accountRef !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googleImportViewEpoch: input.epoch },
  })
}

export function useGoogleImportContentLease(
  input: Readonly<{
    organizationId: string
    connectionId: string | null
    enabled: boolean
    leaseRef: string | null
    renewLease: typeof renewImportAuthorizationLease
    hasProviderContent: boolean
    epoch: number
    guard: EpochGuard
  }>,
) {
  const visibleAndFocused = usePageVisibleAndFocused()
  return useQuery({
    queryKey: integrationKeys.googleImportLease(
      input.organizationId,
      input.connectionId ?? 'none',
      input.leaseRef ?? 'none',
      input.epoch,
    ),
    queryFn: () =>
      input.guard(
        input.epoch,
        input.renewLease({
          data: {
            connectionId: input.connectionId!,
            leaseRef: input.leaseRef!,
          },
        }),
      ),
    enabled:
      input.enabled &&
      input.connectionId !== null &&
      input.leaseRef !== null &&
      input.hasProviderContent &&
      visibleAndFocused,
    refetchInterval: CONTENT_LEASE_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googleImportViewEpoch: input.epoch },
  })
}
