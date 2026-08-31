import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { GoogleImportViewCompletion } from '#/contexts/integration/application/public-api'
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
type EpochGuard = <T>(
  epoch: number,
  operation: Promise<T>,
) => Promise<GoogleImportViewCompletion<T>>

function currentViewInfiniteData<T, TPageParam>(
  data: Readonly<{
    pages: readonly GoogleImportViewCompletion<T>[]
    pageParams: readonly TPageParam[]
  }>,
): Readonly<{ pages: T[]; pageParams: TPageParam[] }> {
  const pages: T[] = []
  const pageParams: TPageParam[] = []
  for (const [index, completion] of data.pages.entries()) {
    if (completion._tag !== 'current_google_import_view') continue
    pages.push(completion.value)
    pageParams.push(data.pageParams[index]!)
  }
  return { pages, pageParams }
}

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
    getNextPageParam: (lastCompletion) =>
      lastCompletion._tag === 'current_google_import_view'
        ? (lastCompletion.value.nextCursor ?? undefined)
        : undefined,
    select: currentViewInfiniteData<AccountsPage, string | undefined>,
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
    getNextPageParam: (lastCompletion) =>
      lastCompletion._tag === 'current_google_import_view'
        ? (lastCompletion.value.nextCursor ?? undefined)
        : undefined,
    select: currentViewInfiniteData<CandidatesPage, string | undefined>,
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
    select: (completion) =>
      completion._tag === 'current_google_import_view' ? completion.value : null,
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
