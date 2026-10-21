import { describe, expect, it } from 'vitest'
import { resolveSupersededReplyRead } from './google-reply-superseded-read'

describe('resolveSupersededReplyRead: a read that a newer read already overtook', () => {
  it('restates the head for a sync read and writes nothing', () => {
    expect(
      resolveSupersededReplyRead(
        { source: 'provider_snapshot' },
        { observationRevision: 7 },
      ),
    ).toEqual({
      observationRevision: 7,
      change: 'unchanged',
      resolution: 'unchanged',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: true,
    })
  })

  it('still refuses a targeted read, whose outcome mapping depends on being told', () => {
    expect(() =>
      resolveSupersededReplyRead(
        { source: 'targeted_reconciliation' },
        { observationRevision: 7 },
      ),
    ).toThrow('superseded by a newer provider read')
  })

  it('refuses a targeted read with the invalid_transition code', () => {
    let code: unknown
    try {
      resolveSupersededReplyRead(
        { source: 'targeted_reconciliation' },
        { observationRevision: 1 },
      )
    } catch (error) {
      code = (error as { code?: unknown }).code
    }

    expect(code).toBe('invalid_transition')
  })
})
