import { describe, expect, it } from 'vitest'
import { describePortalDraftSaveStatus } from './portal-draft-save-status-rules'

describe('describePortalDraftSaveStatus', () => {
  it('says nothing before the first edit', () => {
    expect(
      describePortalDraftSaveStatus({ status: 'idle', savedAt: null, error: null }),
    ).toBeNull()
  })

  it('says "Saving…" both while a keystroke waits and while the write runs', () => {
    for (const status of ['pending', 'saving'] as const) {
      expect(
        describePortalDraftSaveStatus({ status, savedAt: null, error: null }),
      ).toEqual({
        label: 'Saving…',
        tone: 'busy',
        canRetry: false,
      })
    }
  })

  it('says "Draft saved" once the write landed', () => {
    expect(
      describePortalDraftSaveStatus({ status: 'saved', savedAt: 5, error: null }),
    ).toEqual({ label: 'Draft saved', tone: 'ok', canRetry: false })
  })

  it('asks the person to fix a refused edit, with nothing to retry', () => {
    expect(
      describePortalDraftSaveStatus({ status: 'invalid', savedAt: null, error: null }),
    ).toEqual({
      label: 'Not saved · check the highlighted fields',
      tone: 'warn',
      canRetry: false,
    })
  })

  it('offers a retry for a failed write', () => {
    expect(
      describePortalDraftSaveStatus({
        status: 'error',
        savedAt: null,
        error: new Error('x'),
      }),
    ).toEqual({ label: 'Not saved', tone: 'warn', canRetry: true })
  })
})
