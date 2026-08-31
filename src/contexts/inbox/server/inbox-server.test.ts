// Inbox context — server function tests
// Tests DTO validation, error→status mapping.
// Pure unit tests — no DB needed.

import { describe, it, expect } from 'vitest'
import { inboxErrorStatus } from './inbox-shared'
import {
  updateStatusDto,
  bulkUpdateStatusDto,
  getInboxItemsDto,
  INBOX_BULK_LIMIT,
  assignInboxItemDto,
  bulkAssignInboxItemsDto,
  addInboxNoteDto,
  markFeedbackHandledDto,
  correctFeedbackHandlingOutcomeDto,
  stampLastInboxViewDto,
  getInboxItemHistoryDto,
} from '../application/dto/inbox.dto'
import { inboxError, isInboxError } from '../domain/errors'

// ── DTO validation ──────────────────────────────────────────────────

describe('updateStatusDto', () => {
  const validInput = {
    inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
    status: 'closed' as const,
    expectedCommandRevision: 1,
  }

  it('parses valid input', () => {
    expect(updateStatusDto.safeParse(validInput).success).toBe(true)
  })

  it('rejects status "new" (not a valid transition target)', () => {
    expect(updateStatusDto.safeParse({ ...validInput, status: 'new' }).success).toBe(
      false,
    )
  })

  it('rejects invalid status', () => {
    expect(updateStatusDto.safeParse({ ...validInput, status: 'deleted' }).success).toBe(
      false,
    )
  })

  it('rejects non-UUID inboxItemId', () => {
    expect(updateStatusDto.safeParse({ ...validInput, inboxItemId: 'abc' }).success).toBe(
      false,
    )
  })

  it('requires a governed reason for reopen and an explanation only for Other', () => {
    expect(updateStatusDto.safeParse({ ...validInput, status: 'open' }).success).toBe(
      false,
    )
    expect(
      updateStatusDto.safeParse({
        ...validInput,
        status: 'open',
        reopenReason: 'new_information',
      }).success,
    ).toBe(true)
    expect(
      updateStatusDto.safeParse({
        ...validInput,
        status: 'open',
        reopenReason: 'other',
        reopenExplanation: ' ',
      }).success,
    ).toBe(false)
  })
})

describe('getInboxItemsDto', () => {
  it('defaults to newest and accepts oldest', () => {
    expect(getInboxItemsDto.parse({}).sort).toBe('newest')
    expect(getInboxItemsDto.parse({ sort: 'oldest' }).sort).toBe('oldest')
  })

  it('rejects unsupported sort orders', () => {
    expect(getInboxItemsDto.safeParse({ sort: 'highest' }).success).toBe(false)
  })
})

describe('stampLastInboxViewDto', () => {
  it('normalizes an issued ISO response cutoff', () => {
    expect(
      stampLastInboxViewDto.parse({
        responseCutoff: '2026-08-27T12:00:00.000Z',
      }),
    ).toEqual({ responseCutoff: new Date('2026-08-27T12:00:00.000Z') })
  })

  it('requires a valid response cutoff', () => {
    expect(stampLastInboxViewDto.safeParse({}).success).toBe(false)
    expect(
      stampLastInboxViewDto.safeParse({ responseCutoff: 'not-a-date' }).success,
    ).toBe(false)
  })
})

describe('bulkUpdateStatusDto', () => {
  const validInput = {
    items: [
      {
        inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
        expectedCommandRevision: 1,
      },
    ],
    status: 'open' as const,
    reopenReason: 'new_information' as const,
  }

  it('parses valid input', () => {
    expect(bulkUpdateStatusDto.safeParse(validInput).success).toBe(true)
  })

  it('rejects empty array', () => {
    expect(bulkUpdateStatusDto.safeParse({ ...validInput, items: [] }).success).toBe(
      false,
    )
  })

  it('rejects array exceeding 100 items', () => {
    const items = Array.from({ length: INBOX_BULK_LIMIT + 1 }, (_, index) => ({
      inboxItemId: `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`,
      expectedCommandRevision: 1,
    }))
    expect(bulkUpdateStatusDto.safeParse({ ...validInput, items }).success).toBe(false)
  })

  it('rejects duplicate IDs and missing revisions', () => {
    expect(
      bulkUpdateStatusDto.safeParse({
        ...validInput,
        items: [...validInput.items, ...validInput.items],
      }).success,
    ).toBe(false)
    expect(
      bulkUpdateStatusDto.safeParse({
        ...validInput,
        items: [{ inboxItemId: validInput.items[0]!.inboxItemId }],
      }).success,
    ).toBe(false)
  })

  it('rejects status "new" (not valid for bulk)', () => {
    expect(bulkUpdateStatusDto.safeParse({ ...validInput, status: 'new' }).success).toBe(
      false,
    )
  })

  it('rejects status "read" (not valid for bulk)', () => {
    expect(bulkUpdateStatusDto.safeParse({ ...validInput, status: 'read' }).success).toBe(
      false,
    )
  })

  it('rejects bulk close while that workflow is unavailable in beta', () => {
    expect(
      bulkUpdateStatusDto.safeParse({ ...validInput, status: 'closed' }).success,
    ).toBe(false)
  })

  it('requires Other to have a bounded explanation and rejects stray explanations', () => {
    expect(
      bulkUpdateStatusDto.safeParse({
        ...validInput,
        reopenReason: 'other',
        reopenExplanation: ' ',
      }).success,
    ).toBe(false)
    expect(
      bulkUpdateStatusDto.safeParse({
        ...validInput,
        reopenReason: 'other',
        reopenExplanation: 'A new guest message needs follow-up.',
      }).success,
    ).toBe(true)
    expect(
      bulkUpdateStatusDto.safeParse({
        ...validInput,
        reopenExplanation: 'not applicable',
      }).success,
    ).toBe(false)
  })
})

describe('assignInboxItemDto', () => {
  it('accepts the opaque Better Auth user ID used by real assignment targets', () => {
    const result = assignInboxItemDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      assignedToUserId: 'V1StGXR8_Z5jdHi6B-myT',
      expectedCommandRevision: 1,
    })
    expect(result.success).toBe(true)
  })

  it('parses unassignment (null userId)', () => {
    const result = assignInboxItemDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      assignedToUserId: null,
      expectedCommandRevision: 1,
    })
    expect(result.success).toBe(true)
  })

  it.each(['', 'contains whitespace', 'line\nbreak', '<script>', 'x'.repeat(256)])(
    'rejects malformed or unbounded opaque user ID %j',
    (assignedToUserId) => {
      expect(
        assignInboxItemDto.safeParse({
          inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
          assignedToUserId,
          expectedCommandRevision: 1,
        }).success,
      ).toBe(false)
    },
  )
})

describe('bulkAssignInboxItemsDto', () => {
  const item = {
    inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
    expectedCommandRevision: 1,
  }

  it('accepts assign and release while bounding and de-duplicating the batch', () => {
    expect(
      bulkAssignInboxItemsDto.safeParse({
        items: [item],
        assignedToUserId: 'V1StGXR8_Z5jdHi6B-myT',
      }).success,
    ).toBe(true)
    expect(
      bulkAssignInboxItemsDto.safeParse({
        items: [item],
        assignedToUserId: null,
      }).success,
    ).toBe(true)
    expect(
      bulkAssignInboxItemsDto.safeParse({
        items: [item, item],
        assignedToUserId: null,
      }).success,
    ).toBe(false)
    expect(
      bulkAssignInboxItemsDto.safeParse({
        items: [],
        assignedToUserId: null,
      }).success,
    ).toBe(false)
  })

  it.each(['', 'contains whitespace', 'line\nbreak', '<script>', 'x'.repeat(256)])(
    'rejects malformed or unbounded opaque user ID %j',
    (assignedToUserId) => {
      expect(
        bulkAssignInboxItemsDto.safeParse({
          items: [item],
          assignedToUserId,
        }).success,
      ).toBe(false)
    },
  )
})

describe('addInboxNoteDto', () => {
  it('parses valid note', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: 'Called the customer',
      expectedCommandRevision: 1,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty text', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: '',
      expectedCommandRevision: 1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only text and normalizes surrounding whitespace', () => {
    expect(
      addInboxNoteDto.safeParse({
        inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
        text: '   ',
        expectedCommandRevision: 1,
      }).success,
    ).toBe(false)
    expect(
      addInboxNoteDto.parse({
        inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
        text: '  Called the customer  ',
        expectedCommandRevision: 1,
      }).text,
    ).toBe('Called the customer')
  })

  it('rejects text exceeding 5000 chars', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: 'x'.repeat(5001),
      expectedCommandRevision: 1,
    })
    expect(result.success).toBe(false)
  })
})

describe('private-feedback handling DTOs', () => {
  const base = {
    inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
    outcome: 'follow_up_completed' as const,
    internalNote: 'Guest confirmed the issue was resolved.',
    expectedCommandRevision: 2,
    expectedCycleNumber: 1,
    expectedSourceRevision: 4,
    expectedStateRevision: 3,
  }

  it('accepts exactly the controlled manager outcomes and an optional internal note', () => {
    expect(markFeedbackHandledDto.safeParse(base).success).toBe(true)
    expect(
      markFeedbackHandledDto.safeParse({ ...base, internalNote: null }).success,
    ).toBe(true)
    expect(
      markFeedbackHandledDto.safeParse({ ...base, outcome: 'guest_withdrawn' }).success,
    ).toBe(false)
    expect(markFeedbackHandledDto.safeParse({ ...base, outcome: 'closed' }).success).toBe(
      false,
    )
  })

  it('requires positive safe revision fences and bounds internal notes', () => {
    expect(
      markFeedbackHandledDto.safeParse({ ...base, expectedCycleNumber: 0 }).success,
    ).toBe(false)
    expect(
      markFeedbackHandledDto.safeParse({ ...base, expectedStateRevision: 1.5 }).success,
    ).toBe(false)
    expect(
      markFeedbackHandledDto.safeParse({ ...base, internalNote: 'x'.repeat(2_001) })
        .success,
    ).toBe(false)
  })

  it('requires the exact outcome fact when correcting history', () => {
    const correction = {
      ...base,
      expectedOutcomeId: '650e8400-e29b-41d4-a716-446655440000',
      expectedOutcomeRevision: 1,
    }
    expect(correctFeedbackHandlingOutcomeDto.safeParse(correction).success).toBe(true)
    expect(
      correctFeedbackHandlingOutcomeDto.safeParse({
        ...correction,
        expectedOutcomeId: 'not-an-id',
      }).success,
    ).toBe(false)
    expect(
      correctFeedbackHandlingOutcomeDto.safeParse({
        ...correction,
        expectedOutcomeRevision: 0,
      }).success,
    ).toBe(false)
  })
})

// ── Error → HTTP status mapping ─────────────────────────────────────

describe('getInboxItemHistoryDto (IBX-01-T5)', () => {
  // getInboxItemHistoryFn validates with this DTO, so a non-UUID id is rejected
  // at the request boundary — before the use case, and therefore before any
  // store call or permission lookup.
  it('parses a UUID inboxItemId', () => {
    expect(
      getInboxItemHistoryDto.safeParse({
        inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true)
  })

  it('rejects a non-UUID inboxItemId', () => {
    expect(getInboxItemHistoryDto.safeParse({ inboxItemId: 'abc' }).success).toBe(false)
  })

  it('rejects a missing inboxItemId', () => {
    expect(getInboxItemHistoryDto.safeParse({}).success).toBe(false)
  })
})

describe('inboxErrorStatus', () => {
  it('maps invalid_transition to 400', () => {
    expect(inboxErrorStatus('invalid_transition')).toBe(400)
  })

  it('maps invalid_input to 400', () => {
    expect(inboxErrorStatus('invalid_input')).toBe(400)
  })

  it('maps assignment_not_allowed to 400', () => {
    expect(inboxErrorStatus('assignment_not_allowed')).toBe(400)
  })

  it('maps not_found to 404', () => {
    expect(inboxErrorStatus('not_found')).toBe(404)
  })

  it('maps forbidden to 403', () => {
    expect(inboxErrorStatus('forbidden')).toBe(403)
  })

  it('maps already_exists to 409', () => {
    expect(inboxErrorStatus('already_exists')).toBe(409)
  })

  it('maps bulk_partial_failure to 207', () => {
    expect(inboxErrorStatus('bulk_partial_failure')).toBe(207)
  })

  it('maps revision_conflict to 409', () => {
    expect(inboxErrorStatus('revision_conflict')).toBe(409)
  })
})

// ── Error constructor + type guard ──────────────────────────────────

describe('inboxError and isInboxError', () => {
  it('creates a tagged error', () => {
    const err = inboxError('not_found', 'Item not found')
    expect(err._tag).toBe('InboxError')
    expect(err.code).toBe('not_found')
  })

  it('isInboxError returns true for inbox errors', () => {
    expect(isInboxError(inboxError('forbidden', 'No access'))).toBe(true)
  })

  it('isInboxError returns false for generic errors', () => {
    expect(isInboxError(new Error('Generic'))).toBe(false)
  })

  it('isInboxError returns false for null', () => {
    expect(isInboxError(null)).toBe(false)
  })
})
