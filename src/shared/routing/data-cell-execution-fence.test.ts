import { describe, expect, it, vi } from 'vitest'
import {
  createDataCellExecutionFence,
  DataCellExecutionDeniedError,
  type PropertyDataCellFacts,
} from './data-cell-execution-fence'

const US_FACTS: PropertyDataCellFacts = {
  dataCellId: 'us',
  processingRegion: 'us',
  routingPolicyVersion: 2,
}

function fence(facts: PropertyDataCellFacts | null = US_FACTS, localCell = 'us') {
  return createDataCellExecutionFence({
    localCell,
    loadPropertyRouting: vi.fn(async () => facts),
  })
}

describe('DataCellExecutionFence', () => {
  it('allows a current accepting assignment only in the matching process cell', async () => {
    await expect(fence().decideProperty('property-secret')).resolves.toEqual({
      kind: 'allow',
      cell: 'us',
      routingPolicyVersion: 2,
    })
  })

  it('rejects an unknown local PROCESSING_CELL at construction', () => {
    expect(() => fence(US_FACTS, 'eu')).toThrow("Unknown PROCESSING_CELL 'eu'")
  })

  it('denies a known accepting target presented to another process cell', async () => {
    await expect(
      fence(US_FACTS, 'europe').decideProperty('property-secret'),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'wrong_cell',
      localCell: 'europe',
      targetCell: 'us',
    })
  })

  it.each([
    [null, 'property_missing'],
    [
      { dataCellId: null, processingRegion: 'unresolved', routingPolicyVersion: 2 },
      'cell_unresolved',
    ],
    [
      { dataCellId: 'us', processingRegion: 'europe', routingPolicyVersion: 2 },
      'cell_denied',
    ],
    [
      { dataCellId: 'europe', processingRegion: 'europe', routingPolicyVersion: 2 },
      'cell_denied',
    ],
    [
      { dataCellId: 'us', processingRegion: 'us', routingPolicyVersion: 999 },
      'cell_denied',
    ],
  ] as const)('denies invalid/non-accepting facts as %s → %s', async (facts, reason) => {
    await expect(fence(facts).decideProperty('property-secret')).resolves.toMatchObject({
      kind: 'deny',
      reason,
    })
  })

  it('turns routing-store failures into a closed decision', async () => {
    const guarded = createDataCellExecutionFence({
      localCell: 'us',
      loadPropertyRouting: async () => {
        throw new Error('database details that must not escape')
      },
    })
    await expect(guarded.decideProperty('property-secret')).resolves.toEqual({
      kind: 'deny',
      reason: 'routing_unavailable',
      localCell: 'us',
      targetCell: null,
    })
  })

  it('throws a content-free typed error at an asserting boundary', async () => {
    let error: unknown
    try {
      await fence(US_FACTS, 'europe').assertProperty('property-secret', 'server_function')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(DataCellExecutionDeniedError)
    expect(error).toMatchObject({
      boundary: 'server_function',
      reason: 'wrong_cell',
      localCell: 'europe',
      targetCell: 'us',
    })
    expect((error as Error).message).not.toContain('property-secret')
  })
})
