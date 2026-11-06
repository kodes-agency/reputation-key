import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import type { GoogleImportFns } from './google-import-manager-contract'
import {
  getRetryRequest,
  sendRetryWithOneReplay,
  useGoogleImportProgress,
} from './use-google-import-progress'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn(async () => undefined) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'user', organizationId: 'org' }),
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))
const root = setupHookRoot()
type CancelImport = (
  input: Parameters<GoogleImportFns['cancelPropertyImportV2']>[0],
) => Promise<ImportProgressDto>

describe('Google import retry request recovery', () => {
  it('reuses one request ID for the same item revision and rotates after revision advance', () => {
    const requests = new Map()
    const createRequestId = vi
      .fn<() => string>()
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000002')

    const first = getRetryRequest(requests, 'item-1', 3, createRequestId)
    const replay = getRetryRequest(requests, 'item-1', 3, createRequestId)
    const nextRevision = getRetryRequest(requests, 'item-1', 4, createRequestId)

    expect(replay).toBe(first)
    expect(first.retryRequestId).toBe('10000000-0000-4000-8000-000000000001')
    expect(nextRevision.retryRequestId).toBe('10000000-0000-4000-8000-000000000002')
    expect(createRequestId).toHaveBeenCalledTimes(2)
  })

  it('replays the exact retry request once after a dropped response', async () => {
    const request = Object.freeze({
      itemId: 'item-1',
      retryRequestId: '10000000-0000-4000-8000-000000000001',
      expectedRetryRevision: 3,
    })
    const observed: Array<typeof request> = []
    const send = vi.fn(async () => {
      observed.push(request)
      if (observed.length === 1) throw new Error('response dropped')
      return { replayed: true }
    })

    await expect(sendRetryWithOneReplay(send)).resolves.toEqual({ replayed: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(observed).toEqual([request, request])
  })

  it('surfaces failure after the single bounded replay also fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('unavailable'))

    await expect(sendRetryWithOneReplay(send)).rejects.toThrow('unavailable')
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('import progress actions', () => {
  async function mount(
    retry: (
      input: Parameters<GoogleImportFns['retryPropertyImportItem']>[0],
    ) => ReturnType<GoogleImportFns['retryPropertyImportItem']>,
    cancel: CancelImport = vi.fn<CancelImport>(),
  ) {
    navigate.mockClear()
    vi.mocked(toast.error).mockClear()
    const item: ImportProgressItemDto = {
      itemId: 'item',
      propertyName: 'Cafe',
      action: 'create',
      status: 'failed',
      outcomeCode: 'temporarily_unavailable',
      messageKey: 'property_import.temporarily_unavailable',
      retryable: true,
      retryRevision: 0,
      userAction: 'retry',
      propertyId: null,
      invalidProfileField: null,
    }
    const progress: ImportProgressDto = {
      contractVersion: 3,
      importJobId: 'import',
      requestId: 'request',
      status: 'failed',
      totalCount: 1,
      processedCount: 1,
      counts: {
        pending: 0,
        processing: 0,
        imported: 0,
        relinked: 0,
        already_exists: 0,
        failed: 1,
        cancelled: 0,
      },
      items: [item],
      canRetry: true,
      pollAfterMs: null,
      purgeAt: null,
      updatedAt: '2026-11-06T12:00:00.000Z',
    }
    const getStatus = vi.fn(async () => progress)
    let controller: ReturnType<typeof useGoogleImportProgress>
    function Probe() {
      controller = useGoogleImportProgress({
        initialProgress: progress,
        importFns: {
          getPropertyImportV2Status: getStatus,
          retryPropertyImportItem: retry,
          cancelPropertyImportV2: cancel,
        } as unknown as Pick<
          GoogleImportFns,
          | 'getPropertyImportV2Status'
          | 'retryPropertyImportItem'
          | 'cancelPropertyImportV2'
        >,
        step: 'progress',
        setStep: vi.fn(),
      })
      return null
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    await root.render(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    )
    getStatus.mockClear()
    return { getStatus, controller: () => controller!, item, progress }
  }

  it('opens fresh discovery without an old request or selection when confirmation is required', async () => {
    const retry = vi.fn().mockResolvedValue({ confirmationRequired: true })
    const { getStatus, controller, item } = await mount(retry)
    await act(async () => controller().retry(item))
    await root.flush()
    expect(retry).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/properties/import-google',
      search: {},
    })
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('refreshes the existing work after an ordinary accepted retry', async () => {
    const retry = vi
      .fn()
      .mockResolvedValue({ importJobId: 'import', retryRevision: 1, replayed: false })
    const { getStatus, controller, item } = await mount(retry)
    await act(async () => controller().retry(item))
    await root.flush()
    expect(navigate).not.toHaveBeenCalled()
    expect(getStatus).toHaveBeenCalledOnce()
  })

  it('updates progress from the cancellation response without fetching it again', async () => {
    const cancel = vi.fn<CancelImport>()
    const { controller, getStatus, progress } = await mount(vi.fn(), cancel)
    const cancelled = { ...progress, status: 'cancelled' as const }
    cancel.mockResolvedValue(cancelled)

    await act(async () => controller().cancel())
    await root.flush()

    expect(cancel).toHaveBeenCalledExactlyOnceWith({ data: { importJobId: 'import' } })
    expect(controller().progress).toEqual(cancelled)
    expect(controller().isCancelling).toBe(false)
    expect(getStatus).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['processing', 'cancelled'] as const)(
    'reads back a dropped cancellation response when the import is %s',
    async (status) => {
      const cancel = vi.fn().mockRejectedValue(new Error('response dropped'))
      const { controller, getStatus, progress } = await mount(vi.fn(), cancel)
      const recovered = { ...progress, status }
      getStatus.mockResolvedValue(recovered)

      await act(async () => controller().cancel())
      await root.flush()

      expect(cancel).toHaveBeenCalledOnce()
      expect(getStatus).toHaveBeenCalledOnce()
      expect(controller().progress).toEqual(recovered)
      expect(controller().isCancelling).toBe(false)
      if (status === 'cancelled') {
        expect(toast.error).not.toHaveBeenCalled()
      } else {
        expect(toast.error).toHaveBeenCalledExactlyOnceWith(
          'The import could not be cancelled. Refresh its status and try again.',
        )
      }
    },
  )

  it('reports cancellation failure when its read-back is also unavailable', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('response dropped'))
    const { controller, getStatus } = await mount(vi.fn(), cancel)
    getStatus.mockRejectedValue(new Error('read unavailable'))

    await act(async () => controller().cancel())
    await root.flush()

    expect(cancel).toHaveBeenCalledOnce()
    expect(getStatus).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'The import could not be cancelled. Refresh its status and try again.',
    )
  })
})
