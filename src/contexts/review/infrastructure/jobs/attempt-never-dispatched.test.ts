// D4's evidence check: only positive evidence that an attempt never left RepKey
// may move it toward "not published", and a lookup that fails proves nothing.

import { describe, expect, it, vi } from 'vitest'
import type { ReplyDispatchEvidence } from '../../application/ports/reply-publication-dispatch-evidence.port'
import { organizationId, replyId } from '#/shared/domain/ids'
import { attemptNeverDispatched } from './attempt-never-dispatched'

const NOW = new Date('2026-09-15T12:00:00Z')
const ATTEMPT_STARTED_AT = new Date('2026-09-15T11:50:00Z')
const REPLY = {
  organizationId: organizationId('org-1'),
  id: replyId('reply-1'),
  publicationCycle: 2,
  publicationAttempts: 3,
}

function depsAnswering(answer: () => Promise<ReplyDispatchEvidence>) {
  return {
    dispatchEvidence: { findDispatchEvidence: vi.fn(answer) },
    clock: () => NOW,
  }
}

describe('attemptNeverDispatched', () => {
  it('asks about exactly the current attempt, as of the caller clock', async () => {
    const deps = depsAnswering(async () => 'never_dispatched')

    await attemptNeverDispatched(deps, REPLY, ATTEMPT_STARTED_AT, vi.fn())

    expect(deps.dispatchEvidence.findDispatchEvidence).toHaveBeenCalledWith({
      organizationId: REPLY.organizationId,
      replyId: REPLY.id,
      publicationCycle: 2,
      attemptNumber: 3,
      attemptStartedAt: ATTEMPT_STARTED_AT,
      now: NOW,
    })
  })

  it.each([
    ['never_dispatched', true],
    ['possibly_dispatched', false],
    ['too_recent', false],
  ] as const)('answers %s evidence with %s', async (evidence, expected) => {
    const onLookupFailed = vi.fn()

    await expect(
      attemptNeverDispatched(
        depsAnswering(async () => evidence),
        REPLY,
        ATTEMPT_STARTED_AT,
        onLookupFailed,
      ),
    ).resolves.toBe(expected)
    expect(onLookupFailed).not.toHaveBeenCalled()
  })

  it('treats a failed lookup as no evidence and hands the failure to the caller', async () => {
    const failure = new Error('permit ledger read timed out')
    const onLookupFailed = vi.fn()

    await expect(
      attemptNeverDispatched(
        depsAnswering(async () => {
          throw failure
        }),
        REPLY,
        ATTEMPT_STARTED_AT,
        onLookupFailed,
      ),
    ).resolves.toBe(false)
    expect(onLookupFailed).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
