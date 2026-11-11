import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'

const mocks = vi.hoisted(() => ({ getMemberRole: vi.fn(), decide: vi.fn() }))
vi.mock('./repositories/manager-membership.repository', () => ({
  getMemberRole: mocks.getMemberRole,
}))
vi.mock('./repositories/member-property-authority', () => ({
  decideMemberPropertyAuthority: mocks.decide,
}))

import {
  createMerchantAiManagementAuthorizer,
  createStepUpVerifier,
} from './merchant-ai-management'

const db = {} as Database
const NOW = new Date('2026-07-01T00:00:00Z')
const input = {
  organizationId: 'org',
  propertyId: 'prop',
  actorUserId: 'user',
  now: NOW,
}

describe('createMerchantAiManagementAuthorizer', () => {
  beforeEach(() => {
    mocks.getMemberRole.mockReset()
    mocks.decide.mockReset()
  })

  it('refuses a non-member without asking for Property authority', async () => {
    mocks.getMemberRole.mockResolvedValue(null)
    expect(await createMerchantAiManagementAuthorizer(db)(input)).toBe(false)
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('asks for ai.manage on the Property as the member role', async () => {
    mocks.getMemberRole.mockResolvedValue('manager')
    mocks.decide.mockResolvedValue({ allowed: true, scope: 'organization' })
    expect(await createMerchantAiManagementAuthorizer(db)(input)).toBe(true)
    expect(mocks.decide).toHaveBeenCalledWith(db, {
      organizationId: 'org',
      propertyId: 'prop',
      userId: 'user',
      memberRole: 'manager',
      permission: 'ai.manage',
      at: NOW,
    })
  })

  it('refuses when the authority is denied', async () => {
    mocks.getMemberRole.mockResolvedValue('manager')
    mocks.decide.mockResolvedValue({ allowed: false, reason: 'assignment_denied' })
    expect(await createMerchantAiManagementAuthorizer(db)(input)).toBe(false)
  })

  it('refuses when the authority read fails', async () => {
    mocks.getMemberRole.mockResolvedValue('manager')
    mocks.decide.mockRejectedValue(new Error('connection lost'))
    expect(await createMerchantAiManagementAuthorizer(db)(input)).toBe(false)
  })
})

describe('createStepUpVerifier', () => {
  it('refuses without request headers and never checks the password', async () => {
    const verifyPassword = vi.fn()
    expect(await createStepUpVerifier(verifyPassword)({ proof: 'secret' })).toBe(false)
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('passes the proof as the password with the request headers', async () => {
    const headers = new Headers({ cookie: 'session=1' })
    const verifyPassword = vi.fn().mockResolvedValue(true)
    expect(
      await createStepUpVerifier(verifyPassword)({
        requestHeaders: headers,
        proof: 'pw',
      }),
    ).toBe(true)
    expect(verifyPassword).toHaveBeenCalledWith({ headers, password: 'pw' })
  })

  it('refuses a wrong password', async () => {
    const verifyPassword = vi.fn().mockResolvedValue(false)
    expect(
      await createStepUpVerifier(verifyPassword)({
        requestHeaders: new Headers(),
        proof: 'bad',
      }),
    ).toBe(false)
  })
})
