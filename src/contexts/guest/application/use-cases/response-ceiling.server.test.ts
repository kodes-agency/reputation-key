import { describe, expect, it, vi } from 'vitest'
import {
  createResponseCeiling,
  droppedResponseView,
  responseWindowStart,
  type ResponseAdmission,
  type ResponseCeilingStore,
} from './response-ceiling.server'
import { createGuestSessionManager } from '../../server/guest-session'

const now = new Date('2026-11-06T10:00:00Z')
const scope = {
  organizationId: 'tenant-response-test',
  propertyId: 'property',
  portalId: 'portal',
}

describe('a dropped response receipt', () => {
  it('survives a signed-session reload without storing a response or its rating', () => {
    const sessions = createGuestSessionManager({
      secret: '0123456789abcdef0123456789abcdef',
      secureCookies: true,
      clock: () => now,
      randomId: () => crypto.randomUUID(),
    })
    const initial = sessions.issue(scope)
    const receipt = sessions.rememberDroppedResponse(initial.session, 2, now)
    const cookieHeader = receipt.cookies[0].split(';')[0] ?? ''
    const recovered = sessions.verify(cookieHeader, scope)
    expect(recovered?.sessionId).toBe(initial.session.sessionId)
    expect(recovered?.csrfNonce).toBe(initial.session.csrfNonce)
    const view = droppedResponseView(now, recovered?.droppedResponse?.rating ?? null)
    expect(view).toMatchObject({
      dropped: true,
      status: 'submitted',
      rating: 2,
      hasPrivateFeedback: false,
      privateFeedbackEligible: false,
      correctionAvailable: false,
      responseWithdrawalAvailable: false,
      feedbackWithdrawalAvailable: false,
      correctionDeadline: null,
      responseWithdrawalDeadline: null,
    })
    expect(sessions.verify(cookieHeader, { ...scope, portalId: 'other' })).toBeNull()
    expect(sessions.issue(scope).session.droppedResponse).toBeUndefined()
  })
})

const brandedScope = {
  organizationId: 'tenant-response-test',
  propertyId: 'property',
  portalId: 'portal',
} as Parameters<ReturnType<typeof createResponseCeiling>['reserve']>[0]

function fixture(organizationDailyLimit?: number) {
  let current = now
  const records = new Map<
    string,
    { scope: typeof brandedScope; admission: ResponseAdmission }
  >()
  const alerts = new Set<string>()
  const seed = { portalHour: 0, portalDay: 0, organizationDay: 0 }
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  const key = (scope: typeof brandedScope, session: string) =>
    JSON.stringify([scope, session])
  let previous = Promise.resolve()
  const find = async (scope: typeof brandedScope, session: string) =>
    records.get(key(scope, session))?.admission ?? null
  const store: ResponseCeilingStore = {
    find,
    withinOrganization: async (_org, run) => {
      const pending = previous
      let unlock = () => {}
      previous = new Promise<void>((resolve) => {
        unlock = resolve
      })
      await pending
      try {
        return await run({
          find,
          counts: async (scope, at) => {
            const counts = { ...seed }
            for (const { scope: owner, admission } of records.values()) {
              if (
                !admission.allowed ||
                owner.organizationId !== scope.organizationId ||
                admission.recordedAt < responseWindowStart(at, 'portalDay')
              )
                continue
              counts.organizationDay++
              if (owner.portalId === scope.portalId) {
                counts.portalDay++
                if (admission.recordedAt >= responseWindowStart(at, 'portalHour'))
                  counts.portalHour++
              }
            }
            return counts
          },
          record: async (scope, session, admission) => {
            records.set(key(scope, session), { scope, admission })
          },
          claimAlert: async (scope, window, at) => {
            const anchor = JSON.stringify([
              scope.organizationId,
              window === 'organizationDay' ? null : scope.portalId,
              window,
              at,
            ])
            if (alerts.has(anchor)) return false
            alerts.add(anchor)
            return true
          },
        })
      } finally {
        unlock()
      }
    },
  }
  const ceiling = createResponseCeiling({
    store,
    clock: () => current,
    logger,
    organizationDailyLimit,
  })
  return {
    ceiling,
    records,
    seed,
    logger,
    advance: (at: Date) => {
      current = at
    },
  }
}

describe('atomic shared response admission', () => {
  it.each([
    ['portalHour', 300],
    ['portalDay', 2_000],
    ['organizationDay', 5_000],
  ] as const)(
    'admits the last slot and drops the next at %s = %i',
    async (window, limit) => {
      const f = fixture()
      f.seed[window] = limit - 1
      await expect(f.ceiling.reserve(brandedScope, 'last')).resolves.toMatchObject({
        allowed: true,
      })
      await expect(f.ceiling.reserve(brandedScope, 'excess')).resolves.toMatchObject({
        allowed: false,
      })
      expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith(
        { event: 'guest.response_ceiling_exhausted', window },
        'Guest response ceiling exhausted',
      )
    },
  )

  it('serializes concurrent sessions and deduplicates concurrent retries', async () => {
    const f = fixture()
    f.seed.portalHour = 299
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        f.ceiling.reserve(brandedScope, `session-${i}`),
      ),
    )
    expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(1)
    const retries = await Promise.all(
      Array.from({ length: 12 }, () => f.ceiling.reserve(brandedScope, 'session-0')),
    )
    expect(retries.every(({ allowed }) => allowed)).toBe(true)
    expect(f.records.size).toBe(12)
    expect(f.logger.warn).toHaveBeenCalledTimes(1)
  })

  it('keeps a dropped retry dropped when the next window has room', async () => {
    const f = fixture()
    f.seed.portalHour = 300
    const dropped = await f.ceiling.reserve(brandedScope, 'dropped')
    f.seed.portalHour = 0
    f.advance(new Date('2026-11-06T11:00:00Z'))
    await expect(f.ceiling.reserve(brandedScope, 'dropped')).resolves.toEqual(dropped)
    await expect(f.ceiling.reserve(brandedScope, 'fresh')).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('shares the organization ceiling across Portals and permits an independent override', async () => {
    const f = fixture(1)
    await f.ceiling.reserve(brandedScope, 'first')
    await expect(
      f.ceiling.reserve(
        { ...brandedScope, portalId: 'other' as typeof brandedScope.portalId },
        'second',
      ),
    ).resolves.toMatchObject({ allowed: false })
    await expect(
      f.ceiling.reserve(
        {
          ...brandedScope,
          organizationId: 'other' as typeof brandedScope.organizationId,
        },
        'second',
      ),
    ).resolves.toMatchObject({ allowed: true })
    const raised = fixture(6_000)
    raised.seed.organizationDay = 5_000
    await expect(raised.ceiling.reserve(brandedScope, 'next')).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('claims one alert for each exhausted window across Portals and subsequent requests', async () => {
    const f = fixture(1)
    f.seed.organizationDay = 1
    await f.ceiling.reserve(brandedScope, 'first')
    await f.ceiling.reserve(
      { ...brandedScope, portalId: 'other' as typeof brandedScope.portalId },
      'second',
    )
    expect(f.logger.warn).toHaveBeenCalledTimes(1)
    f.advance(new Date('2026-11-07T00:00:00Z'))
    await f.ceiling.reserve(brandedScope, 'third')
    expect(f.logger.warn).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain(
      brandedScope.organizationId,
    )
  })

  it('recovers a content-free dropped state even if the reply cookie was lost, and expires it', async () => {
    const f = fixture(1)
    f.seed.organizationDay = 1
    const sessions = createGuestSessionManager({
      secret: '0123456789abcdef',
      secureCookies: true,
      clock: () => now,
      randomId: () => crypto.randomUUID(),
    })
    const session = sessions.issue(scope).session
    await f.ceiling.reserve(brandedScope, session.sessionId)
    const recovered = await f.ceiling.getDropped(brandedScope, session)
    expect(recovered).toEqual(droppedResponseView(now, null))
    expect(JSON.stringify([...f.records.values()])).not.toContain('rating')
    f.advance(new Date(now.getTime() + 24 * 60 * 60 * 1000))
    await expect(f.ceiling.getDropped(brandedScope, session)).resolves.toBeNull()
  })

  it('places exact UTC hour and day boundaries in the new windows', () => {
    const boundary = new Date('2026-11-07T00:00:00.000Z')
    expect(responseWindowStart(boundary, 'portalHour')).toEqual(boundary)
    expect(responseWindowStart(boundary, 'portalDay')).toEqual(boundary)
    expect(
      responseWindowStart(new Date('2026-11-06T23:59:59.999Z'), 'organizationDay'),
    ).toEqual(new Date('2026-11-06T00:00:00Z'))
  })
})
