import { createHash, timingSafeEqual } from 'node:crypto'
import type {
  CredentialCleanupOutcome,
  CredentialRevokePermitState,
  GoogleCredentialSourceOperationState,
} from './google-content-contract'

export type CredentialRevokePermitEvent =
  | 'consume_without_revoke'
  | 'activate'
  | 'prove_not_sent'
  | 'begin_dispatch'
  | 'confirm_not_sent'
  | 'confirm_revoked'
  | 'mark_ambiguous'
  | 'confirm_provider_reset'

export function transitionCredentialRevokePermit(
  state: CredentialRevokePermitState,
  event: CredentialRevokePermitEvent,
): CredentialRevokePermitState | null {
  switch (state) {
    case 'dormant':
      if (event === 'activate') return 'active'
      return event === 'consume_without_revoke' ? 'consumed_no_revoke' : null
    case 'active':
      if (event === 'prove_not_sent') return 'confirmed_not_sent'
      if (event === 'begin_dispatch') return 'dispatching'
      return null
    case 'dispatching':
      if (event === 'confirm_not_sent') return 'confirmed_not_sent'
      if (event === 'confirm_revoked') return 'confirmed_revoked'
      if (event === 'mark_ambiguous') return 'cleanup_ambiguous'
      return null
    case 'confirmed_not_sent':
    case 'cleanup_ambiguous':
      return event === 'confirm_provider_reset' ? 'provider_reset_confirmed' : null
    case 'consumed_no_revoke':
    case 'confirmed_revoked':
    case 'provider_reset_confirmed':
      return null
  }
}

export type SubjectAuthorityState =
  | 'open'
  | 'source_active'
  | 'cleanup_pending'
  | 'drained'
  | 'provider_reset_required'
  | 'ambiguous'
  | 'provider_reset_terminal'

export function subjectAuthorityStateAfterCleanup(
  outcome: CredentialCleanupOutcome,
): Extract<SubjectAuthorityState, 'drained' | 'provider_reset_required' | 'ambiguous'> {
  switch (outcome) {
    case 'confirmed_revoked':
      return 'drained'
    case 'confirmed_not_sent':
      return 'provider_reset_required'
    case 'cleanup_ambiguous':
      return 'ambiguous'
  }
}

export type CredentialSourceOperationEvent =
  | 'provider_start'
  | 'commit_terminal'
  | 'mark_ambiguous'
  | 'confirm_provider_reset'

export function transitionCredentialSourceOperation(
  state: GoogleCredentialSourceOperationState,
  event: CredentialSourceOperationEvent,
): GoogleCredentialSourceOperationState | null {
  switch (state) {
    case 'registered':
      return event === 'provider_start' ? 'provider_started' : null
    case 'provider_started':
      if (event === 'commit_terminal') return 'terminal'
      if (event === 'mark_ambiguous') return 'provider_outcome_ambiguous'
      return null
    case 'provider_outcome_ambiguous':
      return event === 'confirm_provider_reset' ? 'provider_reset_terminal' : null
    case 'terminal':
    case 'provider_reset_terminal':
      return null
  }
}

export type CredentialRevokePermitAuthority = Readonly<{
  id: string
  guardId: string
  sourceOperationId: string
  state: CredentialRevokePermitState
  tokenHmacKeyVersion: string | null
  tokenHmac: string | null
  cleanupDeadlineAt: Date
  sendAuthorizationExpiresAt: Date | null
  activatedAt: Date | null
  dispatchingAt: Date | null
  terminalAt: Date | null
}>

export type CredentialCleanupPermitCode =
  | 'permit_not_dormant'
  | 'permit_not_active'
  | 'source_operation_mismatch'
  | 'cleanup_deadline_elapsed'
  | 'invalid_send_authorization_window'
  | 'token_hmac_mismatch'

export type CredentialCleanupPermitResult =
  | Readonly<{ ok: true; permit: CredentialRevokePermitAuthority }>
  | Readonly<{ ok: false; code: CredentialCleanupPermitCode }>

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export function activateCredentialRevokePermit(
  permit: CredentialRevokePermitAuthority,
  input: Readonly<{
    sourceOperationId: string
    tokenHmacKeyVersion: string
    tokenHmac: string
    sendAuthorizationExpiresAt: Date
    now: Date
  }>,
): CredentialCleanupPermitResult {
  if (permit.state !== 'dormant') {
    return { ok: false, code: 'permit_not_dormant' }
  }
  if (permit.sourceOperationId !== input.sourceOperationId) {
    return { ok: false, code: 'source_operation_mismatch' }
  }
  if (input.now.getTime() >= permit.cleanupDeadlineAt.getTime()) {
    return { ok: false, code: 'cleanup_deadline_elapsed' }
  }
  if (
    input.tokenHmacKeyVersion.length === 0 ||
    input.tokenHmac.length === 0 ||
    input.sendAuthorizationExpiresAt.getTime() <= input.now.getTime() ||
    input.sendAuthorizationExpiresAt.getTime() > permit.cleanupDeadlineAt.getTime()
  ) {
    return { ok: false, code: 'invalid_send_authorization_window' }
  }
  return {
    ok: true,
    permit: {
      ...permit,
      state: 'active',
      tokenHmacKeyVersion: input.tokenHmacKeyVersion,
      tokenHmac: input.tokenHmac,
      sendAuthorizationExpiresAt: new Date(input.sendAuthorizationExpiresAt.getTime()),
      activatedAt: new Date(input.now.getTime()),
    },
  }
}

export function claimCredentialRevokePermit(
  permit: CredentialRevokePermitAuthority,
  input: Readonly<{
    sourceOperationId: string
    tokenHmacKeyVersion: string
    tokenHmac: string
    now: Date
  }>,
): CredentialCleanupPermitResult {
  if (permit.state !== 'active') {
    return { ok: false, code: 'permit_not_active' }
  }
  if (permit.sourceOperationId !== input.sourceOperationId) {
    return { ok: false, code: 'source_operation_mismatch' }
  }
  if (
    input.now.getTime() >= permit.cleanupDeadlineAt.getTime() ||
    !permit.sendAuthorizationExpiresAt ||
    input.now.getTime() >= permit.sendAuthorizationExpiresAt.getTime()
  ) {
    return { ok: false, code: 'cleanup_deadline_elapsed' }
  }
  if (
    !permit.tokenHmacKeyVersion ||
    !permit.tokenHmac ||
    !constantTimeEqual(permit.tokenHmacKeyVersion, input.tokenHmacKeyVersion) ||
    !constantTimeEqual(permit.tokenHmac, input.tokenHmac)
  ) {
    return { ok: false, code: 'token_hmac_mismatch' }
  }
  return {
    ok: true,
    permit: {
      ...permit,
      state: 'dispatching',
      tokenHmacKeyVersion: null,
      tokenHmac: null,
      sendAuthorizationExpiresAt: null,
      dispatchingAt: new Date(input.now.getTime()),
    },
  }
}

export function expireCredentialRevokePermit(
  permit: CredentialRevokePermitAuthority,
  now: Date,
): CredentialRevokePermitAuthority {
  const cleanupExpired = now.getTime() >= permit.cleanupDeadlineAt.getTime()
  const sendExpired =
    permit.sendAuthorizationExpiresAt !== null &&
    now.getTime() >= permit.sendAuthorizationExpiresAt.getTime()
  if (!cleanupExpired && !sendExpired) return permit

  let state = permit.state
  if (permit.state === 'active') state = 'confirmed_not_sent'
  else if (cleanupExpired && permit.state === 'dispatching') state = 'cleanup_ambiguous'
  else if (cleanupExpired && permit.state === 'dormant') state = 'consumed_no_revoke'

  return {
    ...permit,
    state,
    tokenHmacKeyVersion: null,
    tokenHmac: null,
    sendAuthorizationExpiresAt: null,
    terminalAt:
      state === 'confirmed_not_sent' ||
      state === 'cleanup_ambiguous' ||
      state === 'consumed_no_revoke'
        ? new Date(now.getTime())
        : permit.terminalAt,
  }
}

export function finishCredentialRevokeDispatch(
  permit: CredentialRevokePermitAuthority,
  outcome: CredentialCleanupOutcome,
  now: Date,
): CredentialRevokePermitAuthority | null {
  if (permit.state !== 'dispatching') return null
  const event =
    outcome === 'confirmed_revoked'
      ? 'confirm_revoked'
      : outcome === 'confirmed_not_sent'
        ? 'confirm_not_sent'
        : 'mark_ambiguous'
  const state = transitionCredentialRevokePermit(permit.state, event)
  if (!state) return null
  return {
    ...permit,
    state,
    tokenHmacKeyVersion: null,
    tokenHmac: null,
    sendAuthorizationExpiresAt: null,
    terminalAt: new Date(now.getTime()),
  }
}
