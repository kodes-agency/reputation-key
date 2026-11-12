import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouteHarness } from '#/routes/route-harness'
import { takeDownPortalMedia } from '#/contexts/portal/server/portal-media-takedown'
import { EMPTY_CAPABILITY_SET } from '#/shared/auth/capability-set'
import { useTakeDownImage } from './-portal-media-takedown'

vi.mock('#/contexts/portal/server/portal-media-takedown', () => ({
  takeDownPortalMedia: vi.fn(),
}))

const ASSET_ID = '7b0c4a2e-1f3d-4c52-9a6e-0d8f2b1c3e45'
const writesOn = { ...EMPTY_CAPABILITY_SET, allowed: ['portal.write' as const] }
const writesOff = { ...EMPTY_CAPABILITY_SET, allowed: [] }

describe('useTakeDownImage', () => {
  beforeEach(() => {
    vi.mocked(takeDownPortalMedia).mockReset()
  })

  it('offers the takedown to an Account Admin with Portals writes on', async () => {
    vi.mocked(takeDownPortalMedia).mockResolvedValue({
      assetId: ASSET_ID,
      objectRemoved: true,
    })
    const harness = await createRouteHarness({
      role: 'AccountAdmin',
      capabilities: writesOn,
    })

    const takeDown = harness.renderHook(useTakeDownImage)
    await takeDown?.(ASSET_ID)

    expect(takeDownPortalMedia).toHaveBeenCalledWith({ data: { assetId: ASSET_ID } })
  })

  it('offers nothing to a Property Manager', async () => {
    const harness = await createRouteHarness({
      role: 'PropertyManager',
      capabilities: writesOn,
    })

    expect(harness.renderHook(useTakeDownImage)).toBeUndefined()
  })

  it('offers nothing to an Account Admin while Portals writes are off', async () => {
    const harness = await createRouteHarness({
      role: 'AccountAdmin',
      capabilities: writesOff,
    })

    expect(harness.renderHook(useTakeDownImage)).toBeUndefined()
  })
})
