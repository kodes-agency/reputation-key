import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createReceiptAttemptStore, receiptDate } from './google-receipt-attempt.server'

const schema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  note: z.string().nullable(),
  startedAt: receiptDate,
  endedAt: receiptDate.nullable(),
})

const store = createReceiptAttemptStore('test_scope', schema, 'test_receipt_invalid')

const payload = {
  id: 'a-1',
  version: 1,
  note: null,
  startedAt: '2026-11-23T10:00:00.000Z',
  endedAt: null,
}

describe('receipt attempt store', () => {
  it('reads ISO strings back as dates and keeps explicit nulls', () => {
    expect(store.parse(payload)).toEqual({
      ...payload,
      startedAt: new Date('2026-11-23T10:00:00.000Z'),
    })
  })

  it('accepts the Postgres offset form a purge rewrites', () => {
    const row = store.parse({ ...payload, startedAt: '2026-11-23T10:00:00+00:00' })
    expect(row.startedAt.toISOString()).toBe('2026-11-23T10:00:00.000Z')
  })

  it('writes dates as ISO strings and nulls as null', () => {
    expect(store.toPayload(store.parse(payload))).toEqual(payload)
  })

  it.each([
    ['a missing nullable field', { ...payload, note: undefined }],
    ['a value below the minimum', { ...payload, version: 0 }],
    ['an unsafe integer', { ...payload, version: 2 ** 53 }],
    ['an unreadable date', { ...payload, startedAt: 'not a date' }],
    ['a non-object payload', 'text'],
  ])('throws the one coded error for %s', (_name, bad) => {
    expect(() => store.parse(bad)).toThrow('test_receipt_invalid')
  })
})
