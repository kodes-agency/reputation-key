import { describe, expect, it } from 'vitest'
import { MerchantAiAuthorizationStoreError } from '../application/use-cases/merchant-ai-authorization'
import { standingRenewalErrorSkip } from './repositories/merchant-ai-standing-renewal.repository'

describe('standing renewal expected refusal classification', () => {
  it.each([
    ['version_conflict', 'head_changed'],
    ['invalid_transition', 'head_changed'],
    ['idempotency_conflict', 'head_changed'],
    ['membership_denied', 'no_account_admin'],
    ['assignment_denied', 'no_account_admin'],
    ['property_inactive', 'property_not_manageable'],
    ['no_op', 'already_renewed'],
  ] as const)(
    'retries %s as an expected skip without reporting an exception',
    (code, reason) => {
      expect(
        standingRenewalErrorSkip(new MerchantAiAuthorizationStoreError(code, code)),
      ).toBe(reason)
    },
  )
  it('recognizes a PostgreSQL lock timeout through Drizzle and leaves corruption unexpected', () => {
    expect(standingRenewalErrorSkip({ cause: { code: '55P03' } })).toBe('lock_timeout')
    expect(standingRenewalErrorSkip({ code: '55P03' })).toBe('lock_timeout')
    expect(
      standingRenewalErrorSkip(
        new MerchantAiAuthorizationStoreError('invalid_record', 'bad row'),
      ),
    ).toBeNull()
    expect(standingRenewalErrorSkip(new Error('unexpected'))).toBeNull()
  })
})
