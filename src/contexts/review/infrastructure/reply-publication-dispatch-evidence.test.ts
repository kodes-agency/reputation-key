// Dispatch-evidence window derivation and fail-closed input handling. The
// permit lookup itself is proven against PostgreSQL in the sibling
// `.integration.test.ts`.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  AUTHORIZATION_PERMIT_OPERATION_DEADLINE_MS,
  AUTHORIZATION_PERMIT_START_DEADLINE_MS,
} from '#/shared/auth/authorization-execution-permit'
import { organizationId, replyId } from '#/shared/domain/ids'
import {
  REPLY_DISPATCH_EVIDENCE_MIN_WINDOW_MS,
  REPLY_DISPATCH_EVIDENCE_WINDOW_MS,
  REPLY_PERMIT_OPERATION_DEADLINE_MS,
  REPLY_PERMIT_START_DEADLINE_MS,
  REPLY_PROVIDER_CALL_DEADLINE_MS,
} from '../application/ports/reply-publication-dispatch-evidence.port'
import { createReplyPublicationDispatchEvidence } from './reply-publication-dispatch-evidence'

const NOW = new Date('2026-09-14T12:00:00.000Z')

describe('REPLY_DISPATCH_EVIDENCE_WINDOW_MS', () => {
  it('restates the permit deadlines the issuer and gateway actually enforce', () => {
    expect(REPLY_PERMIT_START_DEADLINE_MS).toBe(AUTHORIZATION_PERMIT_START_DEADLINE_MS)
    expect(REPLY_PERMIT_OPERATION_DEADLINE_MS).toBe(
      AUTHORIZATION_PERMIT_OPERATION_DEADLINE_MS,
    )
    expect(REPLY_PROVIDER_CALL_DEADLINE_MS).toBe(15_000)
  })

  it('covers the whole in-flight call and never drops below five minutes', () => {
    expect(REPLY_DISPATCH_EVIDENCE_MIN_WINDOW_MS).toBe(5 * 60_000)
    expect(REPLY_DISPATCH_EVIDENCE_WINDOW_MS).toBeGreaterThanOrEqual(
      REPLY_PROVIDER_CALL_DEADLINE_MS +
        REPLY_PERMIT_START_DEADLINE_MS +
        REPLY_PERMIT_OPERATION_DEADLINE_MS,
    )
    expect(REPLY_DISPATCH_EVIDENCE_WINDOW_MS).toBe(5 * 60_000)
  })
})

describe('createReplyPublicationDispatchEvidence input fences', () => {
  const select = vi.fn(() => {
    throw new Error('the permit table must not be read for this input')
  })
  const evidence = createReplyPublicationDispatchEvidence({
    select,
  } as unknown as Database)
  const base = {
    organizationId: organizationId('org-evidence-unit'),
    replyId: replyId('a7000000-0000-4000-8000-000000000021'),
    publicationCycle: 1,
    attemptNumber: 1,
    attemptStartedAt: new Date(NOW.getTime() - 60 * 60_000),
    now: NOW,
  }

  it.each([
    ['a zero cycle', { publicationCycle: 0 }],
    ['a zero attempt number', { attemptNumber: 0 }],
    ['a fractional attempt number', { attemptNumber: 1.5 }],
    ['an invalid attempt start', { attemptStartedAt: new Date(Number.NaN) }],
    ['an invalid clock reading', { now: new Date(Number.NaN) }],
  ])('refuses to prove non-dispatch for %s', async (_name, override) => {
    await expect(evidence.findDispatchEvidence({ ...base, ...override })).resolves.toBe(
      'possibly_dispatched',
    )
    expect(select).not.toHaveBeenCalled()
  })

  it('answers too_recent for an attempt that starts after now (clock skew) without a read', async () => {
    await expect(
      evidence.findDispatchEvidence({
        ...base,
        attemptStartedAt: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toBe('too_recent')
    expect(select).not.toHaveBeenCalled()
  })
})
