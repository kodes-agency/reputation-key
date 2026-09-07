import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ImportProgressDto } from '#/contexts/integration/application/public-api'
import { integrationKeys } from '#/shared/queries/query-keys'
import {
  googleImportProgressPollInterval,
  googleImportStatusQuery,
} from './google-import-progress-query'

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
