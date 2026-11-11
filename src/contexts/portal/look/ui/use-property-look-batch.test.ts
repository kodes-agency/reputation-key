// A portal the manager unticked stays unticked when its review is read again,
// even if the new read changes where the portal starts.

import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PortalReview } from '#/contexts/portal/application/portal-management-contracts'
import { portalKeys } from '#/shared/queries/query-keys'
import { act, startHookHarness, type HookHarness } from './hook-harness'
import type { usePropertyLookBatch as UsePropertyLookBatch } from './use-property-look-batch'

const LOOK_EDIT = {
  type: 'edit',
  kind: 'property_brand_profile',
  subject: { area: 'look', facet: null },
  propertyWide: true,
  actor: null,
  occurredAt: '2026-10-01T09:00:00.000Z',
  previousText: null,
  newText: null,
  editCount: 1,
} as const

const reviewOf = (changes: PortalReview['changes']): PortalReview =>
  ({
    portalId: 'portal-1',
    action: 'publish_changes',
    nothingToPublish: false,
    canPublish: true,
    reviewDigest: 'digest',
    publishesAsVersion: 3,
    changes,
    changesMayBeIncomplete: false,
    checks: [],
    languages: [],
  }) as unknown as PortalReview

const LIVE = [{ portalId: 'portal-1' }] as never

describe('usePropertyLookBatch', () => {
  let harness: HookHarness
  let useBatch: typeof UsePropertyLookBatch
  let latest: ReturnType<typeof UsePropertyLookBatch> | undefined
  let client: QueryClient

  beforeAll(async () => {
    harness = await startHookHarness()
    ;({ usePropertyLookBatch: useBatch } = await import('./use-property-look-batch'))
  })
  afterAll(() => harness.stop())
  afterEach(async () => {
    await harness.unmount()
    client.clear()
    latest = undefined
  })

  const reads: PortalReview[] = []
  function Probe() {
    latest = useBatch({
      propertyId: 'property-1',
      live: LIVE,
      getPortalReview: vi.fn(async () => reads[0]!),
      publishPortals: vi.fn() as never,
    })
    return null
  }

  async function show() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await harness.render(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    )
  }

  it('keeps a portal unticked when a fresh review makes it start unticked', async () => {
    reads.splice(0, reads.length, reviewOf([LOOK_EDIT]))
    await show()
    expect(latest!.leftOut.has('portal-1')).toBe(false)

    await act(async () => latest!.toggle('portal-1'))
    expect(latest!.leftOut.has('portal-1')).toBe(true)

    // Someone else saves another edit: the portal now starts unticked.
    reads.splice(0, reads.length, reviewOf([LOOK_EDIT, { type: 'unlisted' }]))
    await act(async () => {
      await client.refetchQueries({
        queryKey: portalKeys.lookReviewOf('property-1', 'portal-1'),
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(latest!.rows![0]!.entry).toMatchObject({ mix: { hasUnlisted: true } })
    expect(latest!.leftOut.has('portal-1')).toBe(true)
  })
})
