import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HAMPTON_READ } from '#/components/features/property/guest-voice/guest-voice-fixtures-check-in'
const state = vi.hoisted(() => ({
  ref: { current: null as string | null },
  status: 'refresh_required',
  query: vi.fn(),
}))
vi.mock('react', () => ({
  useRef: () => state.ref,
  useEffect: (effect: () => void) => effect(),
}))
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: unknown) => {
    state.query(options)
    return { data: { status: state.status }, isError: false }
  },
}))
import { GuestVoiceRouteDetails } from './-guest-voice-route-details'
beforeEach(() => {
  state.ref.current = null
  state.query.mockClear()
  state.status = 'refresh_required'
})
describe('refresh-required detail lifecycle', () => {
  it('refreshes only once per target and exact bounds, then enables the new bounds retry', () => {
    const refreshPage = vi.fn(async () => undefined)
    const navigation = {
      open: vi.fn(),
      scrollRef: { current: null },
      ready: vi.fn(),
      knownTitle: () => null,
      restorePage: vi.fn(),
      backLabel: () => null,
      back: vi.fn(),
    }
    const props = {
      propertyId: 'p',
      range: 'auto' as const,
      read: HAMPTON_READ,
      target: { kind: 'topic', topic: 'safety' } as const,
      busy: false,
      navigation,
      refreshPage,
      children: () => null,
    }
    GuestVoiceRouteDetails(props)
    GuestVoiceRouteDetails(props)
    expect(refreshPage).toHaveBeenCalledTimes(1)
    state.status = 'ready'
    GuestVoiceRouteDetails({
      ...props,
      read: { ...HAMPTON_READ, endLocalDate: '2026-10-02' },
    })
    expect(refreshPage).toHaveBeenCalledTimes(1)
    expect(state.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: expect.arrayContaining(['2026-10-02']),
      }),
    )
    GuestVoiceRouteDetails({ ...props, busy: true })
    expect(state.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    )
  })
})
