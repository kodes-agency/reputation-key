import { describe, expect, it } from 'vitest'
import {
  HISTORY_KEY_PREFIX,
  classifyCodeIssuance,
  compareHistoryDescending,
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyBoundFor,
  historyCategoriesFor,
  pageHistory,
  type PortalHistoryRecord,
} from './portal-history'

const T0 = new Date('2026-09-01T10:00:00.000Z')
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs)

function record(key: string, offsetMs: number): PortalHistoryRecord {
  return {
    key,
    at: at(offsetMs),
    category: 'publishing',
    actorUserId: null,
    detail: { kind: 'portal_created' },
  }
}

describe('historyCategoriesFor', () => {
  it('expands "all" to every category and keeps a single tab as itself', () => {
    expect(historyCategoriesFor('all')).toEqual(['publishing', 'codes', 'health'])
    expect(historyCategoriesFor('codes')).toEqual(['codes'])
  })
})

describe('history cursor', () => {
  it('round-trips a position', () => {
    const key = `${HISTORY_KEY_PREFIX.publication}3f0c2a0e-1111-4222-8333-444455556666`
    const cursor = encodeHistoryCursor({ at: at(5), key })
    expect(decodeHistoryCursor(cursor)).toEqual({ at: at(5), key })
  })

  it.each([
    '',
    'nonsense',
    '12|',
    '|publication:abc',
    'abc|publication:abc',
    '1|unknown:abc',
    '1|publication:has space',
    `${'9'.repeat(20)}|publication:abc`,
    '99999999999999999|publication:abc',
  ])('rejects the malformed cursor %j', (value) => {
    expect(decodeHistoryCursor(value)).toBeNull()
  })
})

describe('compareHistoryDescending', () => {
  it('puts newer first and breaks a time tie by key, highest first', () => {
    const rows = [
      record('health:a', 0),
      record('publication:a', 10),
      record('publication:b', 0),
    ]
    expect([...rows].sort(compareHistoryDescending).map((r) => r.key)).toEqual([
      'publication:a',
      'publication:b',
      'health:a',
    ])
  })
})

describe('pageHistory', () => {
  const rows = [
    record('health:1', 40),
    record('publication:2', 30),
    record('code-issued:3', 30),
    record('health:4', 10),
  ]

  it('returns the newest rows and a cursor at the last one returned', () => {
    const page = pageHistory([...rows].reverse(), 3)
    expect(page.records.map((r) => r.key)).toEqual([
      'health:1',
      'publication:2',
      'code-issued:3',
    ])
    expect(page.next).toEqual({ at: at(30), key: 'code-issued:3' })
  })

  it('has no cursor when everything fits', () => {
    const page = pageHistory(rows, 4)
    expect(page.records).toHaveLength(4)
    expect(page.next).toBeNull()
  })
})

describe('historyBoundFor', () => {
  const position = { at: at(30), key: 'health:0c' }

  it('does not bound the first page', () => {
    expect(historyBoundFor('health:', null)).toBeNull()
  })

  it('bounds the same source by time then by id', () => {
    expect(historyBoundFor('health:', position)).toEqual({
      at: at(30),
      inclusive: true,
      afterId: '0c',
    })
  })

  it('bounds an id-less source by time only', () => {
    expect(
      historyBoundFor('code-revoked:', { at: at(30), key: 'code-revoked:1' }, true),
    ).toEqual({ at: at(30), inclusive: false, afterId: null })
  })

  it('lets a source that sorts before the cursor source keep the tie instant', () => {
    expect(historyBoundFor('code-issued:', position)).toEqual({
      at: at(30),
      inclusive: true,
      afterId: null,
    })
  })

  it('drops the tie instant for a source that sorts after the cursor source', () => {
    expect(historyBoundFor('publication:', position)).toEqual({
      at: at(30),
      inclusive: false,
      afterId: null,
    })
  })

  it('agrees with the merge order for every source pair', () => {
    const sources = Object.values(HISTORY_KEY_PREFIX)
    for (const a of sources) {
      for (const b of sources) {
        const cursorKey = `${b}zz`
        const bound = historyBoundFor(a, { at: at(1), key: cursorKey })
        const rowKey = `${a}aa`
        const sameInstantRowAllowed =
          bound?.inclusive === true && (bound.afterId === null || 'aa' < bound.afterId)
        expect(sameInstantRowAllowed).toBe(rowKey < cursorKey)
      }
    }
  })
})

describe('classifyCodeIssuance', () => {
  const issuedAt = at(100)

  it('calls the first address an issue', () => {
    expect(classifyCodeIssuance({ version: 1, issuedAt }, null)).toEqual({
      kind: 'code_issued',
      version: 1,
    })
  })

  it('calls an address issued while the previous one was still live a replacement', () => {
    expect(
      classifyCodeIssuance(
        { version: 2, issuedAt },
        { revokedAt: null, gracePeriodEnds: at(9_000) },
      ),
    ).toEqual({
      kind: 'code_replaced',
      version: 2,
      previousCodesWorkUntil: at(9_000).toISOString(),
    })
  })

  it('still calls it a replacement when the previous address was revoked afterwards', () => {
    expect(
      classifyCodeIssuance(
        { version: 2, issuedAt },
        { revokedAt: at(500), gracePeriodEnds: null },
      ),
    ).toEqual({ kind: 'code_replaced', version: 2, previousCodesWorkUntil: null })
  })

  it('calls an address issued after the previous one was revoked an issue', () => {
    expect(
      classifyCodeIssuance(
        { version: 2, issuedAt },
        { revokedAt: at(50), gracePeriodEnds: null },
      ),
    ).toEqual({ kind: 'code_issued', version: 2 })
  })
})
