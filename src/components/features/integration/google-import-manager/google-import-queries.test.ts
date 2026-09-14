import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportProgressDto } from '#/contexts/integration/application/public-api'
import { integrationKeys } from '#/shared/queries/query-keys'
import {
  googleImportAccountsQuery,
  googleImportCandidatesQuery,
  googleImportLeaseQuery,
  googleImportProgressPollInterval,
  googleImportStatusQuery,
  scheduleGoogleImportExpiries,
} from './google-import-queries'

const CONNECTION_ID = '10000000-0000-4000-8000-000000000003'
const guard = vi.fn()

const processing: ImportProgressDto = {
  contractVersion: 3,
  importJobId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  status: 'processing',
  totalCount: 1,
  processedCount: 0,
  counts: {
    pending: 1,
    processing: 0,
    imported: 0,
    relinked: 0,
    already_exists: 0,
    failed: 0,
    cancelled: 0,
  },
  items: [],
  canRetry: false,
  pollAfterMs: 2_500,
  purgeAt: null,
  updatedAt: '2026-08-25T10:00:00.000Z',
}

describe('Google import progress query', () => {
  it('uses the import cache key and deduplicates concurrent status reads', async () => {
    let resolveStatus: ((value: ImportProgressDto) => void) | undefined
    const getImportStatus = vi.fn(
      () =>
        new Promise<ImportProgressDto>((resolve) => {
          resolveStatus = resolve
        }),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const options = googleImportStatusQuery(processing.importJobId, getImportStatus)

    expect(options.queryKey).toEqual(integrationKeys.import(processing.importJobId))

    const first = client.fetchQuery(options)
    const concurrent = client.fetchQuery(options)
    expect(getImportStatus).toHaveBeenCalledTimes(1)
    expect(getImportStatus).toHaveBeenCalledWith({
      data: { importJobId: processing.importJobId },
    })

    resolveStatus?.(processing)
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      processing,
      processing,
    ])
  })

  it('polls active jobs at the server cadence and stops when inactive or terminal', () => {
    expect(googleImportProgressPollInterval(processing, true)).toBe(2_500)
    expect(googleImportProgressPollInterval(processing, false)).toBe(false)
    expect(
      googleImportProgressPollInterval(
        { ...processing, status: 'completed', pollAfterMs: null },
        true,
      ),
    ).toBe(false)
    expect(
      googleImportProgressPollInterval(
        { ...processing, status: 'queued', pollAfterMs: null },
        true,
      ),
    ).toBe(false)
    expect(googleImportProgressPollInterval(undefined, true)).toBe(false)
  })
})

describe('Google import discovery while the tab is hidden', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps renewing the authorization lease in the background', () => {
    const options = googleImportLeaseQuery({
      organizationId: 'org-1',
      connectionId: CONNECTION_ID,
      leaseRef: 'lease.ref',
      enabled: true,
      hasProviderContent: true,
      epoch: 0,
      guard,
      renewLease: vi.fn() as never,
    })

    // Visibility is not an input: a hidden tab renews like a visible one, well
    // inside the 30-second lease.
    expect(options.enabled).toBe(true)
    expect(options.refetchInterval).toBe(10_000)
    expect(options.refetchIntervalInBackground).toBe(true)
  })

  it('renews only while the page holds provider content', () => {
    const base = {
      organizationId: 'org-1',
      connectionId: CONNECTION_ID,
      leaseRef: 'lease.ref',
      enabled: true,
      hasProviderContent: true,
      epoch: 0,
      guard,
      renewLease: vi.fn() as never,
    }

    expect(googleImportLeaseQuery({ ...base, hasProviderContent: false }).enabled).toBe(
      false,
    )
    expect(googleImportLeaseQuery({ ...base, leaseRef: null }).enabled).toBe(false)
    expect(googleImportLeaseQuery({ ...base, enabled: false }).enabled).toBe(false)
  })

  it('never refetches a discovery page on return, reconnect or remount', () => {
    const accounts = googleImportAccountsQuery({
      organizationId: 'org-1',
      connectionId: CONNECTION_ID,
      enabled: true,
      epoch: 0,
      guard,
      listAccounts: vi.fn() as never,
    })
    const candidates = googleImportCandidatesQuery({
      organizationId: 'org-1',
      connectionId: CONNECTION_ID,
      accountRef: 'account.ref',
      enabled: true,
      epoch: 0,
      guard,
      listCandidates: vi.fn() as never,
    })

    for (const options of [accounts, candidates]) {
      expect(options.staleTime).toBe(Number.POSITIVE_INFINITY)
      expect(options.refetchOnWindowFocus).toBe(false)
      expect(options.refetchOnReconnect).toBe(false)
      expect(options.refetchOnMount).toBe(false)
      expect(options).not.toHaveProperty('refetchInterval')
    }
  })

  it('clears content at the last renewed lease expiry when no renewal succeeds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'))
    vi.stubGlobal('window', globalThis)
    const clear = vi.fn()

    const cancel = scheduleGoogleImportExpiries(
      { clear },
      '2026-09-16T10:00:00.000Z',
      '2026-09-15T10:00:30.000Z',
    )
    vi.advanceTimersByTime(29_999)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledExactlyOnceWith('lease_expired')

    cancel()
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(clear).toHaveBeenCalledOnce()
  })
})
