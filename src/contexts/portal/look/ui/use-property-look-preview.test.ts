// The phone never shows another portal's page while this one loads, and its
// "Try again" reads again whatever failed, the wording included.

import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, startHookHarness, type HookHarness } from './hook-harness'
import type { usePropertyLookPreview as UsePropertyLookPreview } from './use-property-look-preview'

const loadGuestPortalCopy = vi.hoisted(() => vi.fn())
vi.mock('#/components/features/guest', () => ({ loadGuestPortalCopy }))

const readyPreview = (name: string) => ({
  status: 'ready',
  preview: { primaryLocale: 'en', locales: ['en'], experiences: { en: { name } } },
})

describe('usePropertyLookPreview', () => {
  let harness: HookHarness
  let usePreview: typeof UsePropertyLookPreview
  let latest: ReturnType<typeof UsePropertyLookPreview> | undefined
  let client: QueryClient

  beforeAll(async () => {
    harness = await startHookHarness()
    ;({ usePropertyLookPreview: usePreview } =
      await import('./use-property-look-preview'))
  })
  afterAll(() => harness.stop())
  afterEach(async () => {
    await harness.unmount()
    client.clear()
    latest = undefined
    loadGuestPortalCopy.mockReset()
  })

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

  // One component for every call, so a change of portal re-renders the same hook.
  function Probe({
    portalId,
    reader,
  }: Readonly<{
    portalId: string
    reader: Parameters<typeof UsePropertyLookPreview>[1]
  }>) {
    latest = usePreview({ id: portalId, name: portalId }, reader)
    return null
  }

  async function show(
    portalId: string,
    reader: Parameters<typeof UsePropertyLookPreview>[1],
  ) {
    client ??= new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    })
    await harness.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Probe, { portalId, reader }),
      ),
    )
  }

  it('shows nothing of the previous portal while the next one loads', async () => {
    loadGuestPortalCopy.mockResolvedValue({})
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reader = vi.fn(async ({ data }: { data: { portalId: string } }) =>
      data.portalId === 'a' ? readyPreview('A') : new Promise<never>(() => undefined),
    ) as never
    await show('a', reader)
    await settle()
    expect(latest!.preview).not.toBeNull()

    await show('b', reader)

    expect(latest!.preview).toBeNull()
    expect(latest!.isPending).toBe(true)
  })

  it('reads the wording again on retry when only the wording failed', async () => {
    let isOffline = true
    loadGuestPortalCopy.mockImplementation(async () => {
      if (isOffline) throw new Error('offline')
      return {}
    })
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    const reader = vi.fn(async () => readyPreview('A')) as never
    await show('a', reader)
    await settle()
    expect(latest!.isError).toBe(true)
    const wordingReads = loadGuestPortalCopy.mock.calls.length
    isOffline = false

    await act(async () => {
      await latest!.refetch()
    })
    await settle()

    expect(loadGuestPortalCopy.mock.calls.length).toBeGreaterThan(wordingReads)
    expect(latest!.isError).toBe(false)
  })
})
