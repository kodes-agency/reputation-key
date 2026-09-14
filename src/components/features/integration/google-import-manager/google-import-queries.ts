import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { contentExpiryDelayMs } from '#/contexts/integration/application/public-api'
import type {
  GoogleImportViewCompletion,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import type {
  listImportAccounts,
  listImportCandidates,
  renewImportAuthorizationLease,
} from '#/contexts/integration/server/gbp-import'
import { integrationKeys } from '#/shared/queries/query-keys'
import { isImportParentTerminal } from './google-import-progress-model'

const GOOGLE_IMPORT_LEASE_RENEW_INTERVAL_MS = 10_000

type AwaitedReturn<T extends (...args: never[]) => unknown> = Awaited<
  globalThis.ReturnType<T>
>
type AccountsPage = AwaitedReturn<typeof listImportAccounts>
type CandidatesPage = AwaitedReturn<typeof listImportCandidates>
export type GoogleImportContentGuard = <T>(
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

export function googleImportContentExpiry(
  pages: readonly Readonly<{ contentExpiresAt: string }>[],
): string | null {
  let earliest: string | null = null
  let earliestMs = Number.POSITIVE_INFINITY
  for (const page of pages) {
    const expiresAtMs = Date.parse(page.contentExpiresAt)
    if (!Number.isFinite(expiresAtMs)) return page.contentExpiresAt
    if (expiresAtMs < earliestMs) {
      earliest = page.contentExpiresAt
      earliestMs = expiresAtMs
    }
  }
  return earliest
}

type ContentLifecycle = Readonly<{
  clear: (reason: 'content_expired' | 'lease_expired') => void
}>

/**
 * The deadlines that clear provider content without a server answer: the
 * checkpoint's absolute content deadline and the last renewed lease expiry. The
 * lease timer is also the backstop for a renewal that failed transiently.
 */
export function scheduleGoogleImportExpiries(
  lifecycle: ContentLifecycle,
  contentExpiresAt: string | null,
  leaseExpiresAt: string | null,
): () => void {
  const schedule = (
    reason: 'content_expired' | 'lease_expired',
    expiresAt: string | null,
  ) =>
    expiresAt === null
      ? undefined
      : window.setTimeout(
          () => lifecycle.clear(reason),
          contentExpiryDelayMs(expiresAt, Date.now()),
        )
  const contentTimeout = schedule('content_expired', contentExpiresAt)
  const leaseTimeout = schedule('lease_expired', leaseExpiresAt)
  return () => {
    if (contentTimeout !== undefined) window.clearTimeout(contentTimeout)
    if (leaseTimeout !== undefined) window.clearTimeout(leaseTimeout)
  }
}

export function googleImportAccountsQuery(input: {
  organizationId: string
  connectionId: string | null
  enabled: boolean
  epoch: number
  guard: GoogleImportContentGuard
  listAccounts: typeof listImportAccounts
}) {
  return infiniteQueryOptions({
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
    getNextPageParam: (completion) =>
      completion._tag === 'current_google_import_view'
        ? (completion.value.nextCursor ?? undefined)
        : undefined,
    select: currentViewInfiniteData<AccountsPage, string | undefined>,
    enabled: input.enabled && input.connectionId !== null,
    // A discovery page is fetched once per view epoch. It never refetches in the
    // background or when a hidden tab returns: that would call Google again.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googleImportViewEpoch: input.epoch },
  })
}

export function googleImportCandidatesQuery(input: {
  organizationId: string
  connectionId: string | null
  accountRef: string | null
  enabled: boolean
  epoch: number
  guard: GoogleImportContentGuard
  listCandidates: typeof listImportCandidates
}) {
  return infiniteQueryOptions({
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
            ? { connectionId: input.connectionId!, cursorRef: pageParam }
            : {
                connectionId: input.connectionId!,
                accountRef: input.accountRef!,
              },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (completion) =>
      completion._tag === 'current_google_import_view'
        ? (completion.value.nextCursor ?? undefined)
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

/**
 * Renews the 30-second authorization lease every 10 seconds for as long as the
 * import page holds provider content, including while the tab is hidden, so a
 * manager who switches tabs comes back to the same selection. Renewal
 * revalidates current access on the server and never calls Google.
 */
export function googleImportLeaseQuery(input: {
  organizationId: string
  connectionId: string | null
  leaseRef: string | null
  enabled: boolean
  hasProviderContent: boolean
  epoch: number
  guard: GoogleImportContentGuard
  renewLease: typeof renewImportAuthorizationLease
}) {
  return queryOptions({
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
      input.hasProviderContent,
    refetchInterval: GOOGLE_IMPORT_LEASE_RENEW_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googleImportViewEpoch: input.epoch },
  })
}

export type GoogleImportStatusLoader = (input: {
  data: { importJobId: string }
}) => Promise<ImportProgressDto>

export function googleImportStatusQuery(
  importJobId: string,
  getImportStatus: GoogleImportStatusLoader,
) {
  return queryOptions({
    queryKey: integrationKeys.import(importJobId),
    queryFn: () => getImportStatus({ data: { importJobId } }),
    staleTime: 0,
    retry: false,
  })
}

export function googleImportProgressPollInterval(
  progress: ImportProgressDto | undefined,
  active: boolean,
): number | false {
  if (!active || !progress || isImportParentTerminal(progress.status)) return false
  return progress.pollAfterMs ?? false
}
