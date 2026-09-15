import { describe, expect, it } from 'vitest'
import {
  merchantAiCapabilityChangeInputSchema,
  merchantAiCommandInputSchema,
  merchantAiConsentCommandInputSchema,
  merchantAiEnableForPropertiesInputSchema,
} from './merchant-ai-command.dto'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const ACKNOWLEDGEMENT = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: 'a'.repeat(64),
}
const COMMAND = {
  propertyId: PROPERTY_ID,
  idempotencyKey: 'request-key-1',
  expectedStateVersion: 0,
}

describe('Merchant AI command DTOs', () => {
  it('grants consent only with a well-formed notice acknowledgement', () => {
    expect(
      merchantAiConsentCommandInputSchema.safeParse({
        ...COMMAND,
        acknowledgement: ACKNOWLEDGEMENT,
      }).success,
    ).toBe(true)
    for (const acknowledgement of [
      undefined,
      { ...ACKNOWLEDGEMENT, noticeDigest: 'A'.repeat(64) },
      { ...ACKNOWLEDGEMENT, noticeDigest: 'a'.repeat(63) },
      { ...ACKNOWLEDGEMENT, noticeVersion: '' },
    ]) {
      expect(
        merchantAiConsentCommandInputSchema.safeParse({ ...COMMAND, acknowledgement })
          .success,
      ).toBe(false)
    }
  })

  it('strips a password and refuses consent without an acknowledgement', () => {
    const withPassword = { ...COMMAND, password: 'no-longer-a-proof' }
    expect(merchantAiConsentCommandInputSchema.safeParse(withPassword).success).toBe(
      false,
    )
    const revoke = merchantAiCommandInputSchema.parse(withPassword)
    expect(revoke).not.toHaveProperty('password')
  })

  it('bounds a capability change to one to three known capabilities', () => {
    const change = (capabilities: unknown) =>
      merchantAiCapabilityChangeInputSchema.safeParse({
        ...COMMAND,
        acknowledgement: ACKNOWLEDGEMENT,
        capabilities,
      }).success
    expect(change(['review_analysis', 'property_trends'])).toBe(true)
    expect(change([])).toBe(false)
    expect(change(['review_analysis', 'unknown'])).toBe(false)
  })

  it('bounds one consent ceremony to between one and a hundred properties', () => {
    const propertyIds = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      )
    const ceremony = (overrides: Record<string, unknown>) =>
      merchantAiEnableForPropertiesInputSchema.safeParse({
        propertyIds: propertyIds(2),
        capabilities: ['review_analysis'],
        acknowledgement: ACKNOWLEDGEMENT,
        idempotencyKey: 'ceremony-key-1',
        ...overrides,
      }).success

    expect(ceremony({})).toBe(true)
    expect(ceremony({ propertyIds: propertyIds(100) })).toBe(true)
    expect(ceremony({ propertyIds: [] })).toBe(false)
    expect(ceremony({ propertyIds: propertyIds(101) })).toBe(false)
    expect(ceremony({ propertyIds: ['not-a-uuid'] })).toBe(false)
    expect(ceremony({ capabilities: [] })).toBe(false)
    expect(ceremony({ acknowledgement: undefined })).toBe(false)
    expect(ceremony({ idempotencyKey: 'short' })).toBe(false)
  })
})
