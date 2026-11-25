import { describe, expect, it, vi } from 'vitest'
import type { ContactRequestNotice } from '#/shared/domain/contact-request-notice'

vi.mock('#/composition', () => ({ getContainer: vi.fn() }))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: vi.fn() }))

import { readContactRequestsLaunch } from './portal-contact-requests-launch'

const NOTICE: ContactRequestNotice = {
  noticeId: 'privacy-notice',
  noticeVersion: '4.0',
  noticeDigest: 'c'.repeat(64),
  locales: ['en'],
}

describe('readContactRequestsLaunch', () => {
  it('is not launched while the safety block stands, even with the switch on', () => {
    expect(
      readContactRequestsLaunch({ switchedOn: true, safetyBlocked: true }).launched,
    ).toBe(false)
  })

  it('is not launched while the switch is off, even with the block lifted', () => {
    expect(
      readContactRequestsLaunch({ switchedOn: false, safetyBlocked: false }).launched,
    ).toBe(false)
  })

  it('is launched with the switch on and the block lifted', () => {
    expect(
      readContactRequestsLaunch({ switchedOn: true, safetyBlocked: false }).launched,
    ).toBe(true)
  })

  it('says whether a notice covering contact requests is in force', () => {
    const facts = { switchedOn: true, safetyBlocked: false }
    expect(
      readContactRequestsLaunch({ ...facts, noticesInForce: [] }).noticeInForce,
    ).toBe(false)
    expect(
      readContactRequestsLaunch({ ...facts, noticesInForce: [NOTICE] }).noticeInForce,
    ).toBe(true)
    expect(readContactRequestsLaunch(facts).noticeInForce).toBe(false)
  })
})
