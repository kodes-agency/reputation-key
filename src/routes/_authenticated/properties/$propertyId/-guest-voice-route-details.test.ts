import { createElement, type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HAMPTON_READ } from '#/components/features/property/guest-voice/guest-voice-fixtures-check-in'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { createRouteHarness } from '#/routes/route-harness'
import { GuestVoiceRouteDetails } from './-guest-voice-route-details'

const server = vi.hoisted(() => ({ detail: vi.fn() }))
vi.mock('./-guest-voice-fns', () => ({
  guestVoiceFns: { getGuestVoiceDetail: server.detail },
}))

const root = setupHookRoot()
type Props = ComponentProps<typeof GuestVoiceRouteDetails>
type Drawer = Parameters<Props['children']>[0]

const navigation: Props['navigation'] = {
  open: vi.fn(),
  scrollRef: { current: null },
  ready: vi.fn(),
  knownTitle: () => null,
  restorePage: vi.fn(),
  backLabel: () => null,
  back: vi.fn(),
}

describe('refresh-required detail lifecycle', () => {
  let harness: Awaited<ReturnType<typeof createRouteHarness>>
  let drawer: Drawer
  let props: Props
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.stubGlobal('self', globalThis)
    server.detail.mockResolvedValue({ status: 'refresh_required' })
    harness = await createRouteHarness()
    props = {
      propertyId: 'property-1',
      range: 'auto',
      read: HAMPTON_READ,
      target: { kind: 'topic', topic: 'safety' },
      busy: false,
      navigation,
      refreshPage: vi.fn(async () => undefined),
      children: (value) => {
        drawer = value
        return null
      },
    }
  })
  const render = async (next: Props = props) => {
    await root.render(harness.provide(createElement(GuestVoiceRouteDetails, next)))
    await root.flush()
  }

  it('refreshes only once per target and exact bounds, then reads the new bounds', async () => {
    await render()
    expect(props.refreshPage).toHaveBeenCalledOnce()
    await render()
    expect(props.refreshPage).toHaveBeenCalledOnce()
    server.detail.mockResolvedValueOnce({ status: 'not_found' })
    const next = { ...props, read: { ...HAMPTON_READ, endLocalDate: '2026-10-02' } }
    await render(next)
    expect(server.detail).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ endLocalDate: '2026-10-02', target: props.target }),
    })
    expect(drawer.read.status).toBe('not_found')
    expect(props.refreshPage).toHaveBeenCalledOnce()
    await render({ ...next, target: { kind: 'topic', topic: 'staff_service' } })
    expect(props.refreshPage).toHaveBeenCalledTimes(2)
  })

  it.each([{ busy: true }, { target: null }])(
    'does not request details when $busy / $target',
    async (change) => {
      await render({ ...props, ...change })
      expect(server.detail).not.toHaveBeenCalled()
      expect(props.refreshPage).not.toHaveBeenCalled()
      expect(drawer.target).toBeNull()
    },
  )

  it('offers a retry after a read fails and recovers through the real query', async () => {
    server.detail.mockRejectedValueOnce(new Error('Read unavailable'))
    await render()
    expect(drawer.read.status).toBe('error')
    if (drawer.read.status !== 'error') throw new Error('The drawer must offer retry')
    server.detail.mockResolvedValueOnce({ status: 'not_found' })
    drawer.read.onRetry()
    await root.flush()
    await root.flush()
    expect(drawer.read.status).toBe('not_found')
    expect(server.detail).toHaveBeenCalledTimes(2)
  })
})
