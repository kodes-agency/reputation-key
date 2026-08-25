import { describe, expect, it } from 'vitest'
import { decodeInboxCursor } from './inbox-cursor'

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64')

describe('decodeInboxCursor', () => {
  it('returns a typed cursor from the canonical wire representation', () => {
    expect(
      decodeInboxCursor(
        encode({
          sourceDate: '2026-08-25T12:34:56.789Z',
          id: 'a0000000-0000-4000-8000-000000000001',
        }),
      ),
    ).toEqual({
      sourceDate: new Date('2026-08-25T12:34:56.789Z'),
      id: 'a0000000-0000-4000-8000-000000000001',
    })
  })

  it.each([
    ['invalid base64', 'not base64!'],
    ['non-object JSON', encode([])],
    [
      'invalid date',
      encode({
        sourceDate: 'not-a-date',
        id: 'a0000000-0000-4000-8000-000000000001',
      }),
    ],
    [
      'non-canonical date',
      encode({
        sourceDate: '2026-08-25 12:34:56Z',
        id: 'a0000000-0000-4000-8000-000000000001',
      }),
    ],
    [
      'invalid UUID',
      encode({ sourceDate: '2026-08-25T12:34:56.789Z', id: 'not-a-uuid' }),
    ],
    [
      'oversized payload',
      encode({
        sourceDate: '2026-08-25T12:34:56.789Z',
        id: 'a0000000-0000-4000-8000-000000000001',
        padding: 'x'.repeat(1_024),
      }),
    ],
  ])('rejects %s before it can reach PostgreSQL', (_case, encoded) => {
    expect(decodeInboxCursor(encoded)).toBeNull()
  })
})
