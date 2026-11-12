import { createElement, useEffect, type ComponentProps } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { RouterProvider } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { createRouteHarness } from '#/routes/route-harness'
import { createKeys } from '#/shared/queries/query-keys'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import type { ProductUpdatesClient } from '#/shared/whats-new/types'
import { merchantAiNoticeUpdateKey } from '#/components/features/settings/merchant-ai-notice-update-query'
import type { MerchantAiNoticeUpdateBanner } from '#/components/features/settings/merchant-ai-notice-update-banner'
import { useLeadingAiUpdate } from '#/contexts/identity/updates/ui/use-leading-ai-update'
import MerchantAiNoticeUpdateGate from './-merchant-ai-notice-update'
import { merchantAiNoticeUpdateClient } from './-merchant-ai-notice-update-client'
import { Route as AuthenticatedRoute } from '../_authenticated'
import { propertiesQuery } from '../-queries/route-queries'
import { UNKNOWN_VIEWPORT } from '#/components/hooks/viewport-hint'

const server = vi.hoisted(() => ({ get: vi.fn(), markSeen: vi.fn() }))
vi.mock('#/contexts/identity/server/merchant-ai-notice-updates', () => ({
  getMerchantAiNoticeUpdateFn: server.get,
  markMerchantAiNoticeUpdateSeenFn: server.markSeen,
}))
vi.mock('#/components/layout/manager-sidebar', () => ({ ManagerSidebar: () => null }))
vi.mock('#/components/layout/settings-sidebar', () => ({ SettingsSidebar: () => null }))
vi.mock('#/components/layout/app-top-bar', () => ({ AppTopBar: () => null }))
let banner: ComponentProps<typeof MerchantAiNoticeUpdateBanner> | undefined
vi.mock('#/components/features/settings/merchant-ai-notice-update-banner', () => ({
  MerchantAiNoticeUpdateBanner: (
    props: ComponentProps<typeof MerchantAiNoticeUpdateBanner>,
  ) => {
    banner = props
    return null
  },
}))
const update: MerchantAiNoticeUpdate = {
  title: 'An AI update',
  points: ['Details'],
  noticeVersion: 'notice-1',
  noticeDigest: 'a'.repeat(64),
  renewedAt: '2026-11-01T09:00:00.000Z',
}
const scope = { userId: 'user-1', organizationId: 'organization-1' }
const client: ProductUpdatesClient = {
  get: vi.fn(),
  claim: vi.fn(),
  markSeen: vi.fn(),
  setAutoShow: vi.fn(),
  aiNoticeUpdate: merchantAiNoticeUpdateClient,
}
const root = setupHookRoot()
let leading: ReturnType<typeof useLeadingAiUpdate>
function WhatsNew() {
  const value = useLeadingAiUpdate(scope, async () => client)
  useEffect(() => {
    leading = value
  }, [value])
  return null
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('self', globalThis)
  banner = undefined
  server.get.mockResolvedValue(update)
})

describe('merchant AI update readers', () => {
  it.each([false, true])(
    'the AccountAdmin shell mounts the notice only with ai.manage (granted: %s)',
    async (mayManageAi) => {
      const harness = await createRouteHarness({
        role: 'AccountAdmin',
        authz: {
          effectivePermissions: mayManageAi
            ? ['property.read', 'ai.manage']
            : ['property.read'],
          scopeByPermission: {},
        },
      })
      harness.queryClient.setQueryData(propertiesQuery.queryKey, { properties: [] })
      harness.authenticated
        .updateLoader({ loader: () => ({ viewportHint: UNKNOWN_VIEWPORT }) })
        .update({ component: AuthenticatedRoute.options.component })
      await harness.router.invalidate()
      const stream = await renderToReadableStream(
        harness.provide(createElement(RouterProvider, { router: harness.router })),
      )
      await stream.allReady
      const html = await new Response(stream).text()
      expect(html).toContain('<main')
      const noticeQuery = harness.queryClient.getQueryState(
        merchantAiNoticeUpdateKey(scope),
      )
      if (mayManageAi) {
        expect(banner).toBeDefined()
        expect(noticeQuery).toBeDefined()
      } else {
        expect(server.get).not.toHaveBeenCalled()
        expect(banner).toBeUndefined()
        expect(noticeQuery).toBeUndefined()
      }
    },
  )

  it.each(['PropertyManager', 'Member'] as const)(
    'starts no notice read for %s and settles without an update',
    async (role) => {
      const harness = await createRouteHarness({ role })
      await root.render(
        harness.provide([
          createElement(MerchantAiNoticeUpdateGate, { key: 'banner' }),
          createElement(WhatsNew, { key: 'whats-new' }),
        ]),
      )
      expect(server.get).not.toHaveBeenCalled()
      expect(banner).toBeUndefined()
      expect(leading.update).toBeNull()
      expect(leading.settled).toBe(true)
    },
  )

  it('does not read through What’s new when ai.manage is absent', async () => {
    const harness = await createRouteHarness({
      authz: { effectivePermissions: ['property.read'], scopeByPermission: {} },
    })
    await root.render(harness.provide(createElement(WhatsNew)))
    expect(server.get).not.toHaveBeenCalled()
    expect(leading.settled).toBe(true)
  })

  it('shares the read and receipt between the banner and What’s new without touching another tenant', async () => {
    const harness = await createRouteHarness()
    const otherScope = { ...scope, organizationId: 'organization-2' }
    const overview = createKeys(scope).identityKeys.merchantAiOverview()
    harness.queryClient.setQueryData(overview, { saved: true })
    harness.queryClient.setQueryData(merchantAiNoticeUpdateKey(otherScope), update)
    await root.render(
      harness.provide([
        createElement(MerchantAiNoticeUpdateGate, { key: 'banner' }),
        createElement(WhatsNew, { key: 'whats-new' }),
      ]),
    )
    await root.flush()
    expect(server.get).toHaveBeenCalledOnce()
    expect(banner?.update).toEqual(update)
    expect(leading.update).toEqual(update)
    await leading.markSeen(update)
    await root.flush()
    expect(server.markSeen).toHaveBeenCalledExactlyOnceWith({
      data: { noticeVersion: update.noticeVersion, noticeDigest: update.noticeDigest },
    })
    expect(banner?.update).toBeNull()
    expect(leading.update).toBeNull()
    expect(harness.queryClient.getQueryState(overview)?.isInvalidated).toBe(true)
    expect(
      harness.queryClient.getQueryData(merchantAiNoticeUpdateKey(otherScope)),
    ).toEqual(update)
  })

  it('keeps both readers retryable when recording the receipt fails', async () => {
    const harness = await createRouteHarness()
    await root.render(
      harness.provide([
        createElement(MerchantAiNoticeUpdateGate, { key: 'banner' }),
        createElement(WhatsNew, { key: 'whats-new' }),
      ]),
    )
    await root.flush()
    const refusal = new Error('Receipt unavailable')
    server.markSeen.mockRejectedValueOnce(refusal)
    await expect(leading.markSeen(update)).rejects.toBe(refusal)
    await root.flush()
    expect(banner?.update).toEqual(update)
    expect(leading.update).toEqual(update)
    if (!banner) throw new Error('The banner must remain available')
    await banner.markSeen(update)
    await root.flush()
    expect(leading.update).toBeNull()
  })

  it('settles a failed side read without a leading update', async () => {
    server.get.mockRejectedValueOnce(new Error('Side read unavailable'))
    const harness = await createRouteHarness()
    await root.render(harness.provide(createElement(WhatsNew)))
    await root.flush()
    expect(leading.settled).toBe(true)
    expect(leading.update).toBeNull()
  })
})
