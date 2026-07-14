// Inbox context — server function tests
// Tests DTO validation, error→status mapping.
// Pure unit tests — no DB needed.

import { describe, it, expect } from 'vitest'
import { inboxErrorStatus } from './inbox-shared'
import {
  updateStatusDto,
  bulkUpdateStatusDto,
  assignInboxItemDto,
  addInboxNoteDto,
} from '../application/dto/inbox.dto'
import { inboxError, isInboxError } from '../domain/errors'

// ── DTO validation ──────────────────────────────────────────────────

describe('updateStatusDto', () => {
  const validInput = {
    inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
    status: 'closed' as const,
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
})

describe('bulkUpdateStatusDto', () => {
  const validInput = {
    inboxItemIds: ['550e8400-e29b-41d4-a716-446655440000'],
    status: 'closed' as const,
  }

  it('parses valid input', () => {
    expect(bulkUpdateStatusDto.safeParse(validInput).success).toBe(true)
  })

  it('rejects empty array', () => {
    expect(
      bulkUpdateStatusDto.safeParse({ ...validInput, inboxItemIds: [] }).success,
    ).toBe(false)
  })

  it('rejects array exceeding 100 items', () => {
    const ids = Array(101).fill('550e8400-e29b-41d4-a716-446655440000')
    expect(
      bulkUpdateStatusDto.safeParse({ ...validInput, inboxItemIds: ids }).success,
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
})

describe('assignInboxItemDto', () => {
  it('parses valid assignment', () => {
    const result = assignInboxItemDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      assignedToUserId: '660e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('parses unassignment (null userId)', () => {
    const result = assignInboxItemDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      assignedToUserId: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID userId', () => {
    const result = assignInboxItemDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      assignedToUserId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })
})

describe('addInboxNoteDto', () => {
  it('parses valid note', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: 'Called the customer',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty text', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects text exceeding 5000 chars', () => {
    const result = addInboxNoteDto.safeParse({
      inboxItemId: '550e8400-e29b-41d4-a716-446655440000',
      text: 'x'.repeat(5001),
    })
    expect(result.success).toBe(false)
  })
})

// ── Error → HTTP status mapping ─────────────────────────────────────

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
