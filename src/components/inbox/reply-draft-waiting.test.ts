import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createReplyDraftSession, isDraftWaiting } from './reply-draft-session'
import { ReplyDraftWaiting, draftStepText } from './reply-draft-waiting'
import { Skeleton } from '#/components/ui/skeleton'
describe('waiting card', () => {
  it('prints the local voice verbatim and exposes Stop and a named body placeholder', () => {
    const state = {
      ...createReplyDraftSession('', async () => {}).getSnapshot(),
      frame: { prefix: 'Hello Anna,', suffix: 'Kind regards,\nOur team' },
    }
    const markup = renderToStaticMarkup(
      createElement(ReplyDraftWaiting, { state, onStop: vi.fn(), onTemplates: vi.fn() }),
    )
    expect(isDraftWaiting(true, true, state)).toBe(true)
    expect(isDraftWaiting(false, true, state)).toBe(false)
    expect(markup).toContain('Hello Anna,')
    expect(markup).toContain('Kind regards,\nOur team')
    expect(markup).toContain('about 5 seconds')
    expect(markup).toContain('>Stop</button>')
    expect(markup).toContain('Reply body is being written')
    expect(
      renderToStaticMarkup(createElement(Skeleton, { variant: 'reply-body' })),
    ).toContain('data-variant="reply-body"')
  })
  it('uses actual steps, and offers templates after the slow threshold', () => {
    const state = createReplyDraftSession('', async () => {}).getSnapshot()
    expect(
      draftStepText({
        ...state,
        progress: { step: 'rewording', ordinal: 1, sequence: 3 },
      }),
    ).toBe('Rewording one phrase…')
    const slow = renderToStaticMarkup(
      createElement(ReplyDraftWaiting, {
        state: { ...state, slow: true },
        onStop: vi.fn(),
        onTemplates: vi.fn(),
      }),
    )
    expect(slow).not.toContain('about 5 seconds')
    expect(slow).toContain('>use a template</button>')
    const rewording = renderToStaticMarkup(
      createElement(ReplyDraftWaiting, {
        state: { ...state, progress: { step: 'rewording', ordinal: 1, sequence: 3 } },
        onStop: vi.fn(),
        onTemplates: vi.fn(),
      }),
    )
    expect(rewording).toContain('a few more seconds')
    expect(rewording).not.toContain('about 5 seconds')
    expect(draftStepText({ ...state, slow: true })).toBe(
      'Taking longer than usual. Keep waiting, press Stop, or use a template.',
    )
  })
})
