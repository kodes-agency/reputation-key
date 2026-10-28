// The shell's three checks: always asked on the server, remembered in the browser for
// 30 seconds under the signed-in person, and never remembered when they say no.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { EMPTY_CAPABILITY_SET, type CapabilitySet } from '#/shared/auth/capability-set'
import { readShellChecks, type ShellCheckFns } from './shell-context-checks'
import {
  invalidateShellContext,
  shellContextKeys,
} from '#/shared/queries/shell-context-cache'

type Session = Readonly<{ user: Readonly<{ id: string; name: string }> }>
type Organization = Readonly<{ admitted: boolean; name: string }>

const ANA: Session = { user: { id: 'user-ana', name: 'Ana' } }
const BO: Session = { user: { id: 'user-bo', name: 'Bo' } }
const RIVERSIDE: Organization = { admitted: true, name: 'Riverside Hotels' }
const PROPERTY_A = '10000000-0000-4000-8000-00000000000a'
const PROPERTY_B = '10000000-0000-4000-8000-00000000000b'
const START = new Date('2026-10-28T10:00:00Z').getTime()

const capabilitySetFor = (propertyId: string | null): CapabilitySet => ({
  ...EMPTY_CAPABILITY_SET,
  propertyId,
  allowed: ['goal.use'],
})

function serverFns() {
  return {
    session: vi.fn(async (): Promise<Session | null> => ANA),
    organization: vi.fn(async (): Promise<Organization> => RIVERSIDE),
    capabilities: vi.fn(async (propertyId: string | null) =>
      capabilitySetFor(propertyId),
    ),
    admitsShell: (organization: Organization) => organization.admitted,
  } satisfies ShellCheckFns<Session, Organization>
}

const unauthenticated = () => Object.assign(new Error('Unauthorized'), { status: 401 })

const shellEntries = (queryClient: QueryClient) =>
  queryClient.getQueryCache().findAll({ queryKey: shellContextKeys.all })

const later = (ms: number) => vi.setSystemTime(START + ms)

describe('readShellChecks', () => {
  let queryClient: QueryClient
  let fns: ReturnType<typeof serverFns>
  const read = (side: 'server' | 'browser', propertyId: string | null = PROPERTY_A) =>
    readShellChecks({ queryClient, propertyId, side, fns })
  const asked = () => [
    fns.session.mock.calls.length,
    fns.organization.mock.calls.length,
    fns.capabilities.mock.calls.length,
  ]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: START })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
    fns = serverFns()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('on the server', () => {
    it('asks all three every time and keeps nothing in the request cache', async () => {
      await read('server')
      await read('server')

      expect(asked()).toEqual([2, 2, 2])
      expect(shellEntries(queryClient)).toEqual([])
    })

    it('hands back each answer as it came, a failure included', async () => {
      const failure = new Error('capability service unavailable')
      fns.capabilities.mockRejectedValueOnce(failure)

      await expect(read('server')).resolves.toEqual({
        session: { ok: true, value: ANA },
        organization: { ok: true, value: RIVERSIDE },
        capabilities: { ok: false, error: failure },
      })
    })
  })

  describe('in the browser', () => {
    it('asks all three at once the first time', async () => {
      await expect(read('browser')).resolves.toEqual({
        session: { ok: true, value: ANA },
        organization: { ok: true, value: RIVERSIDE },
        capabilities: { ok: true, value: capabilitySetFor(PROPERTY_A) },
      })
      expect(asked()).toEqual([1, 1, 1])
    })

    it('answers a navigation within 30 seconds from what it remembered', async () => {
      const first = await read('browser')
      later(29_999)

      await expect(read('browser')).resolves.toEqual(first)
      expect(asked()).toEqual([1, 1, 1])
    })

    it('asks all three again once the session is 30 seconds old', async () => {
      await read('browser')
      later(30_001)

      await read('browser')
      expect(asked()).toEqual([2, 2, 2])
    })

    it('asks for the capability set of a Property it has not seen, and only that', async () => {
      await read('browser', PROPERTY_A)

      await expect(read('browser', PROPERTY_B)).resolves.toMatchObject({
        capabilities: { ok: true, value: { propertyId: PROPERTY_B } },
      })
      expect(asked()).toEqual([1, 1, 2])
      await read('browser', PROPERTY_A)
      expect(asked()).toEqual([1, 1, 2])
    })

    it('never remembers a missing session', async () => {
      fns.session.mockResolvedValueOnce(null)
      await expect(read('browser')).resolves.toMatchObject({
        session: { ok: true, value: null },
      })
      expect(shellEntries(queryClient)).toEqual([])

      await read('browser')
      expect(fns.session).toHaveBeenCalledTimes(2)
    })

    it('never remembers a failed session read', async () => {
      fns.session.mockRejectedValueOnce(new Error('auth down'))
      await read('browser')
      expect(shellEntries(queryClient)).toEqual([])
    })

    it('never remembers an Organization answer that keeps the person out', async () => {
      fns.organization.mockResolvedValueOnce({
        admitted: false,
        name: 'Riverside Hotels',
      })
      await read('browser')

      await expect(read('browser')).resolves.toMatchObject({
        organization: { ok: true, value: RIVERSIDE },
      })
      // The session was fresh, so only the Organization was asked again.
      expect(asked()).toEqual([1, 2, 1])
    })

    it('asks a failed Organization or capability read again, without retrying it', async () => {
      fns.organization.mockRejectedValueOnce(new Error('organization down'))
      await read('browser')
      later(1_000)
      fns.capabilities.mockRejectedValueOnce(new Error('capability down'))
      // Fresh session: a different Property makes the capability set a new question.
      await expect(read('browser', PROPERTY_B)).resolves.toMatchObject({
        organization: { ok: true, value: RIVERSIDE },
        capabilities: { ok: false },
      })
      expect(asked()).toEqual([1, 2, 2])

      await read('browser', PROPERTY_B)
      expect(asked()).toEqual([1, 2, 3])
    })

    it('forgets everything when any check says the session ended', async () => {
      await read('browser')
      fns.capabilities.mockRejectedValueOnce(unauthenticated())

      await expect(read('browser', PROPERTY_B)).resolves.toMatchObject({
        capabilities: { ok: false },
      })
      expect(shellEntries(queryClient)).toEqual([])
    })

    it('forgets everything on a 401 even when it came with a fresh session answer', async () => {
      fns.organization.mockRejectedValueOnce(unauthenticated())
      await read('browser')
      expect(shellEntries(queryClient)).toEqual([])
    })

    it("never answers for one person from another's entries", async () => {
      await read('browser')
      later(30_001)
      fns.session.mockResolvedValue(BO)
      fns.organization.mockRejectedValueOnce(new Error('organization down'))

      await read('browser')

      // Ana's Organization entry is gone, not kept beside Bo's session.
      expect(queryClient.getQueryData(shellContextKeys.organization(ANA.user.id))).toBe(
        undefined,
      )
      await expect(read('browser')).resolves.toMatchObject({
        session: { ok: true, value: BO },
        organization: { ok: true, value: RIVERSIDE },
      })
      expect(fns.organization).toHaveBeenCalledTimes(3)
    })

    it('asks once for a preload and the click that follows it', async () => {
      const [preload, click] = await Promise.all([read('browser'), read('browser')])

      expect(click).toEqual(preload)
      expect(asked()).toEqual([1, 1, 1])
    })

    it('keeps nothing asked before a forget, and shares no such question', async () => {
      let answer: (session: Session) => void = () => undefined
      fns.session.mockImplementationOnce(
        () => new Promise<Session>((resolve) => (answer = resolve)),
      )
      const before = read('browser')
      // A sign-out or a profile save while the question is out.
      invalidateShellContext(queryClient)
      const after = read('browser')
      answer(ANA)
      await Promise.all([before, after])

      expect(fns.session).toHaveBeenCalledTimes(2)
      // Only the answer asked after the forget was kept.
      await read('browser')
      expect(asked()).toEqual([2, 2, 2])
    })

    it('asks all three again after the shell context is invalidated', async () => {
      await read('browser')
      invalidateShellContext(queryClient)

      await read('browser')
      expect(asked()).toEqual([2, 2, 2])
    })
  })
})
