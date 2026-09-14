import { describe, expect, it } from 'vitest'
import {
  merchantAiCapabilityChangeInputSchema,
  merchantAiCommandInputSchema,
  merchantAiConsentCommandInputSchema,
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
})
