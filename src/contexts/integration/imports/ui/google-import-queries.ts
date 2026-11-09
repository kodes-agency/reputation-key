import type { TenantScope } from '#/shared/queries/tenant-scope'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { contentExpiryDelayMs } from '#/contexts/integration/application/public-api'
import type {
  GoogleImportViewCompletion,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import type {
  listImportAccounts,
  listImportCandidates,
} from '#/contexts/integration/server/gbp-import'
import { createKeys } from '#/shared/queries/query-keys'
import { isImportParentTerminal } from './google-import-progress-model'

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
  clear: (reason: 'content_expired') => void
}>

/** The checkpoint's absolute content deadline clears provider content without a server answer. */
export function scheduleGoogleImportExpiry(
  lifecycle: ContentLifecycle,
  contentExpiresAt: string | null,
): () => void {
  if (contentExpiresAt === null) return () => undefined
  const timeout = window.setTimeout(
    () => lifecycle.clear('content_expired'),
    contentExpiryDelayMs(contentExpiresAt, Date.now()),
  )
  return () => window.clearTimeout(timeout)
}

export function googleImportAccountsQuery(input: {
  scope: TenantScope
  organizationId: string
  connectionId: string | null
  enabled: boolean
  epoch: number
  guard: GoogleImportContentGuard
  listAccounts: typeof listImportAccounts
}) {
  return infiniteQueryOptions({
    queryKey: createKeys(input.scope).integrationKeys.googleImportAccounts(
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
  scope: TenantScope
  organizationId: string
  connectionId: string | null
  accountRef: string | null
  enabled: boolean
  epoch: number
  guard: GoogleImportContentGuard
  listCandidates: typeof listImportCandidates
}) {
  return infiniteQueryOptions({
    queryKey: createKeys(input.scope).integrationKeys.googleImportCandidates(
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

export type GoogleImportStatusLoader = (input: {
  data: { importJobId: string }
}) => Promise<ImportProgressDto>

export function googleImportStatusQuery(
  scope: TenantScope,
  importJobId: string,
  getImportStatus: GoogleImportStatusLoader,
) {
  return queryOptions({
    queryKey: createKeys(scope).integrationKeys.import(importJobId),
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
