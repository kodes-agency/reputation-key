import { describe, expect, it } from 'vitest'
import {
  APPROVED_CORRELATION_FIELDS,
  BANNED_LOG_KEYS,
  isBannedLogKey,
} from './log-field-policy.test-fixtures'

describe('log field policy', () => {
  it('approved correlation fields are exactly requestId + correlationId', () => {
    expect([...APPROVED_CORRELATION_FIELDS]).toEqual(['requestId', 'correlationId'])
  })

  it('approved correlation fields are never banned', () => {
    for (const f of APPROVED_CORRELATION_FIELDS) {
      expect(isBannedLogKey(f)).toBe(false)
    }
  })

  it('bans the known offender keys found by the 7.3 sweep', () => {
    for (const key of [
      'organizationId',
      'userId',
      'propertyId',
      'reviewId',
      'replyId',
      'jobId',
      'eventId',
      'connectionId',
      'jobData',
      'locationName',
      'email',
      'token',
      'password',
      'password_hash',
      'clientSecret',
      'OPENAI_API_KEY',
      'contactEmail',
      'reviewText',
      'DATABASE_URL',
    ]) {
      expect(isBannedLogKey(key), key).toBe(true)
    }
  })

  it('does not ban content-free operational fields', () => {
    for (const key of [
      'jobName',
      'queue',
      'reason',
      'duration',
      'count',
      'role',
      'useCase',
    ]) {
      expect(isBannedLogKey(key), key).toBe(false)
    }
  })

  it('has no duplicate banned keys', () => {
    expect(new Set(BANNED_LOG_KEYS).size).toBe(BANNED_LOG_KEYS.length)
  })
})
