import { describe, expect, it } from 'vitest'
import {
  activateCredentialRevokePermit,
  claimCredentialRevokePermit,
  expireCredentialRevokePermit,
  finishCredentialRevokeDispatch,
  subjectAuthorityStateAfterCleanup,
  transitionCredentialRevokePermit,
  transitionCredentialSourceOperation,
  type CredentialRevokePermitAuthority,
} from './google-credential-authority'

const cleanupPermit = (): CredentialRevokePermitAuthority => ({
  id: 'cleanup-1',
  guardId: 'guard-1',
  sourceOperationId: 'source-1',
  state: 'dormant',
  tokenHmacKeyVersion: null,
  tokenHmac: null,
  cleanupDeadlineAt: new Date('2026-08-10T10:10:00.000Z'),
  sendAuthorizationExpiresAt: null,
  activatedAt: null,
  dispatchingAt: null,
  terminalAt: null,
})
describe('Google credential authority state machines', () => {
  it('consumes dormant cleanup without a provider revoke', () => {
    expect(transitionCredentialRevokePermit('dormant', 'consume_without_revoke')).toBe(
      'consumed_no_revoke',
    )
    expect(transitionCredentialRevokePermit('dormant', 'begin_dispatch')).toBeNull()
  })

  it('requires a durable dispatching boundary before provider outcomes', () => {
    expect(transitionCredentialRevokePermit('active', 'prove_not_sent')).toBe(
      'confirmed_not_sent',
    )
    expect(transitionCredentialRevokePermit('active', 'begin_dispatch')).toBe(
      'dispatching',
    )
    expect(transitionCredentialRevokePermit('active', 'confirm_revoked')).toBeNull()
    expect(transitionCredentialRevokePermit('dispatching', 'confirm_not_sent')).toBe(
      'confirmed_not_sent',
    )
    expect(transitionCredentialRevokePermit('dispatching', 'confirm_revoked')).toBe(
      'confirmed_revoked',
    )
    expect(transitionCredentialRevokePermit('dispatching', 'mark_ambiguous')).toBe(
      'cleanup_ambiguous',
    )
  })

  it('allows provider reset only for non-revoked outcomes', () => {
    expect(
      transitionCredentialRevokePermit('confirmed_not_sent', 'confirm_provider_reset'),
    ).toBe('provider_reset_confirmed')
    expect(
      transitionCredentialRevokePermit('cleanup_ambiguous', 'confirm_provider_reset'),
    ).toBe('provider_reset_confirmed')
    expect(
      transitionCredentialRevokePermit('confirmed_revoked', 'confirm_provider_reset'),
    ).toBeNull()
  })

  it('never treats a non-revoked child as drained authority', () => {
    expect(subjectAuthorityStateAfterCleanup('confirmed_revoked')).toBe('drained')
    expect(subjectAuthorityStateAfterCleanup('confirmed_not_sent')).toBe(
      'provider_reset_required',
    )
    expect(subjectAuthorityStateAfterCleanup('cleanup_ambiguous')).toBe('ambiguous')
  })

  it('keeps ambiguous source outcomes nonterminal until provider reset', () => {
    expect(transitionCredentialSourceOperation('registered', 'provider_start')).toBe(
      'provider_started',
    )
    expect(
      transitionCredentialSourceOperation('provider_started', 'commit_terminal'),
    ).toBe('terminal')
    expect(
      transitionCredentialSourceOperation('provider_started', 'mark_ambiguous'),
    ).toBe('provider_outcome_ambiguous')
    expect(
      transitionCredentialSourceOperation(
        'provider_outcome_ambiguous',
        'confirm_provider_reset',
      ),
    ).toBe('provider_reset_terminal')
    expect(
      transitionCredentialSourceOperation(
        'provider_outcome_ambiguous',
        'commit_terminal',
      ),
    ).toBeNull()
  })

  it('activates only the matching source operation within the cleanup window', () => {
    const activated = activateCredentialRevokePermit(cleanupPermit(), {
      sourceOperationId: 'source-1',
      tokenHmacKeyVersion: 'hmac-v1',
      tokenHmac: 'abc123',
      sendAuthorizationExpiresAt: new Date('2026-08-10T10:05:00.000Z'),
      now: new Date('2026-08-10T10:00:00.000Z'),
    })
    expect(activated).toMatchObject({
      ok: true,
      permit: {
        state: 'active',
        tokenHmacKeyVersion: 'hmac-v1',
        tokenHmac: 'abc123',
      },
    })
    expect(
      activateCredentialRevokePermit(cleanupPermit(), {
        sourceOperationId: 'source-2',
        tokenHmacKeyVersion: 'hmac-v1',
        tokenHmac: 'abc123',
        sendAuthorizationExpiresAt: new Date('2026-08-10T10:05:00.000Z'),
        now: new Date('2026-08-10T10:00:00.000Z'),
      }),
    ).toEqual({ ok: false, code: 'source_operation_mismatch' })
  })

  it('claims exact-token authorization once and clears its HMAC atomically', () => {
    const activated = activateCredentialRevokePermit(cleanupPermit(), {
      sourceOperationId: 'source-1',
      tokenHmacKeyVersion: 'hmac-v1',
      tokenHmac: 'abc123',
      sendAuthorizationExpiresAt: new Date('2026-08-10T10:05:00.000Z'),
      now: new Date('2026-08-10T10:00:00.000Z'),
    })
    if (!activated.ok) throw new Error('expected activation')
    expect(
      claimCredentialRevokePermit(activated.permit, {
        sourceOperationId: 'source-1',
        tokenHmacKeyVersion: 'hmac-v1',
        tokenHmac: 'wrong',
        now: new Date('2026-08-10T10:01:00.000Z'),
      }),
    ).toEqual({ ok: false, code: 'token_hmac_mismatch' })

    const claimed = claimCredentialRevokePermit(activated.permit, {
      sourceOperationId: 'source-1',
      tokenHmacKeyVersion: 'hmac-v1',
      tokenHmac: 'abc123',
      now: new Date('2026-08-10T10:01:00.000Z'),
    })
    expect(claimed).toMatchObject({
      ok: true,
      permit: {
        state: 'dispatching',
        tokenHmacKeyVersion: null,
        tokenHmac: null,
        sendAuthorizationExpiresAt: null,
      },
    })
    if (!claimed.ok) throw new Error('expected claim')
    expect(
      claimCredentialRevokePermit(claimed.permit, {
        sourceOperationId: 'source-1',
        tokenHmacKeyVersion: 'hmac-v1',
        tokenHmac: 'abc123',
        now: new Date('2026-08-10T10:01:01.000Z'),
      }),
    ).toEqual({ ok: false, code: 'permit_not_active' })
  })

  it('expires unconsumed authorization without retaining its HMAC', () => {
    const activated = activateCredentialRevokePermit(cleanupPermit(), {
      sourceOperationId: 'source-1',
      tokenHmacKeyVersion: 'hmac-v1',
      tokenHmac: 'abc123',
      sendAuthorizationExpiresAt: new Date('2026-08-10T10:05:00.000Z'),
      now: new Date('2026-08-10T10:00:00.000Z'),
    })
    if (!activated.ok) throw new Error('expected activation')
    const expired = expireCredentialRevokePermit(
      activated.permit,
      new Date('2026-08-10T10:05:00.000Z'),
    )
    expect(expired).toMatchObject({
      state: 'confirmed_not_sent',
      tokenHmacKeyVersion: null,
      tokenHmac: null,
      sendAuthorizationExpiresAt: null,
    })
  })

  it('requires a durable dispatch claim before a provider outcome', () => {
    const dispatching: CredentialRevokePermitAuthority = {
      ...cleanupPermit(),
      state: 'dispatching',
      dispatchingAt: new Date('2026-08-10T10:01:00.000Z'),
    }
    expect(
      finishCredentialRevokeDispatch(
        dispatching,
        'confirmed_revoked',
        new Date('2026-08-10T10:01:01.000Z'),
      ),
    ).toMatchObject({ state: 'confirmed_revoked' })
    expect(
      finishCredentialRevokeDispatch(
        cleanupPermit(),
        'confirmed_revoked',
        new Date('2026-08-10T10:01:01.000Z'),
      ),
    ).toBeNull()
  })
})
