// The reply composer controller over the real autosave coordinator and the real
// reply commands (`useReplyActions`, with its revision fence) under a real
// QueryClient. Only the HTTP edge and the AI assist are faked, and the timers.

import { describe, expect, it, vi } from 'vitest'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { installInboxCacheHarness } from '#/components/inbox/inbox-cache-test-harness'
import {
  createReplyComposerController,
  type ReplyAiPort,
} from './reply-composer-controller'
import type { ReplyComposerInput } from '#/components/inbox/reply-suggestion-contract'
import { useReplyActions } from '#/components/inbox/use-reply-actions'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const replyServer = vi.hoisted(() => ({
  draftReplyFn: vi.fn(),
  submitReplyFn: vi.fn(),
  approveReplyFn: vi.fn(),
  rejectReplyFn: vi.fn(),
  deleteReplyFn: vi.fn(),
  retryPublishFn: vi.fn(),
  checkReplyPublicationFn: vi.fn(),
  editPublishedReplyFn: vi.fn(),
  listReplyTemplatesFn: vi.fn(),
  loadReplyTemplateFn: vi.fn(),
}))
vi.mock('#/contexts/review/server/reply', () => replyServer)
vi.mock('#/contexts/review/server/reply-templates', () => replyServer)

const REVIEW_ID = 'review-1'
const SAVED_TEXT = 'Thank you for staying.'
const DEBOUNCE_MS = 700

const pane = installInboxCacheHarness()

const savedReply = {
  id: 'reply-1',
  reviewId: REVIEW_ID,
  status: 'draft',
  text: SAVED_TEXT,
  stateRevision: 1,
} as unknown as NonNullable<InboxItemDetailResult['reply']>

/** A controller wired as the composer is: real commands, a recording AI port. */
function openComposer(overrides: Partial<ReplyComposerInput> = {}) {
  let revision = 1
  replyServer.draftReplyFn.mockImplementation(
    async ({ data }: { data: { text: string } }) => ({
      ...savedReply,
      text: data.text,
      stateRevision: ++revision,
    }),
  )
  replyServer.submitReplyFn.mockResolvedValue({ ...savedReply, status: 'pending' })
  replyServer.deleteReplyFn.mockResolvedValue(undefined)
  const actions = pane.renderHooks(() =>
    useReplyActions({ reviewId: REVIEW_ID, reply: savedReply, onReplyChanged: () => {} }),
  )
  const input: ReplyComposerInput = {
    initialText: SAVED_TEXT,
    initialLanguageTag: 'en-Latn',
    initialAiGenerated: false,
    propertyLanguage: 'en-Latn',
    reviewLanguage: 'en-Latn',
    reviewLanguageReadiness: 'detectable',
    onSaveDraft: actions.saveDraft,
    onSubmit: actions.submitReply,
    ...overrides,
  }
  const controller = createReplyComposerController(input)
  const calls: string[] = []
  const request = vi.fn<ReplyAiPort['request']>(async () => undefined)
  controller.bind({
    ai: {
      dismiss: (explicit) => calls.push(`dismiss(${String(explicit)})`),
      replyEdited: () => calls.push('replyEdited'),
      restoreMeasurement: () => calls.push('restoreMeasurement'),
      request,
    },
    clearLoadedTemplateMessage: () => calls.push('clearLoaded'),
  })
  const disconnect = controller.connect()
  return { actions, controller, calls, request, disconnect }
}

const savedTexts = () =>
  (replyServer.draftReplyFn.mock.calls as Array<[{ data: { text: string } }]>).map(
    ([call]) => call.data.text,
  )

describe('typing', () => {
  it('retires the preview, tells the stream, then moves the revision, once per edit', () => {
    const { controller, calls } = openComposer()

    controller.typeText('Thank you for staying with us.')
    expect(calls).toEqual(['dismiss(false)', 'replyEdited', 'clearLoaded'])
    expect(controller.revision.current).toBe(1)

    controller.typeText('Thank you for staying with us!')
    expect(controller.revision.current).toBe(2)
  })

  it('saves the text once after the pause and reports Saved', async () => {
    const { controller } = openComposer()

    controller.typeText('Thank you')
    controller.typeText('Thank you for staying with us.')
    expect(controller.getSnapshot().autosave.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(savedTexts()).toEqual(['Thank you for staying with us.'])
    expect(controller.getSnapshot().autosave.status).toBe('saved')
  })
})

describe('undo', () => {
  it('puts back the draft before an adoption, with its provenance, and bumps the revision', () => {
    const { controller, calls } = openComposer()
    controller.adopt({ text: 'Dear guest', languageTag: 'en-Latn' }, 'personalized')
    expect(controller.getSnapshot().history).toHaveLength(1)
    calls.length = 0

    controller.undo()

    const state = controller.getSnapshot()
    expect(state.draft.text).toBe(SAVED_TEXT)
    expect(state.hasAiDraft).toBe(false)
    expect(state.adoption).toBeNull()
    expect(state.history).toHaveLength(0)
    expect(calls).toEqual([
      'restoreMeasurement',
      'dismiss(false)',
      'replyEdited',
      'clearLoaded',
    ])
    expect(controller.revision.current).toBe(2)
  })

  it('does nothing without history', () => {
    const { controller, calls } = openComposer()

    controller.undo()

    expect(calls).toEqual([])
    expect(controller.revision.current).toBe(0)
  })
})

describe('adopting', () => {
  it('saves an AI draft with its provenance token and adopts it without retiring the preview', async () => {
    const { controller, calls } = openComposer()
    const draft = { text: 'Dear guest, thank you.', languageTag: 'en-Latn' }

    await controller.acceptAiDraft(draft, 'token-1')
    controller.adopt(draft, 'personalized')

    expect(replyServer.draftReplyFn.mock.calls[0]?.[0].data).toMatchObject({
      text: draft.text,
      provenanceToken: 'token-1',
    })
    expect(controller.getSnapshot()).toMatchObject({
      draft,
      hasAiDraft: true,
      adoption: { kind: 'personalized' },
    })
    expect(calls).toEqual([])
    expect(controller.revision.current).toBe(1)
  })

  it('saves an AI draft that has no token as an ordinary save', async () => {
    const { controller } = openComposer()
    const draft = { text: 'Dear guest, thank you.', languageTag: 'en-Latn' }

    await controller.acceptAiDraft(draft, null)

    expect(replyServer.draftReplyFn.mock.calls[0]?.[0].data).not.toHaveProperty(
      'provenanceToken',
    )
    expect(savedTexts()).toEqual([draft.text])
  })

  it('adopts a template first and saves it after, having forgotten what the server holds', async () => {
    const { controller } = openComposer()
    const draft = { text: 'We appreciate your feedback.', languageTag: 'en-Latn' }

    controller.serverDraftUnknown()
    controller.adopt(draft, 'library_template', {
      templateId: 'builtin:thanks',
      title: 'Thanks',
    })
    expect(controller.getSnapshot().draft).toEqual(draft)
    expect(savedTexts()).toEqual([])
    await controller.acceptTemplateDraft(draft)

    expect(savedTexts()).toEqual([draft.text])
    expect(controller.getSnapshot().adoption).toMatchObject({
      kind: 'library_template',
      template: { templateId: 'builtin:thanks' },
    })
  })

  it('writes the box again after a template load, even when it equals the last save', async () => {
    const { controller } = openComposer()

    controller.serverDraftUnknown()
    await controller.acceptTemplateDraft({ text: SAVED_TEXT, languageTag: 'en-Latn' })

    expect(savedTexts()).toEqual([SAVED_TEXT])
  })
})

describe('submit', () => {
  it('saves the typed text first and submits once, with that draft', async () => {
    const { controller } = openComposer()

    controller.typeText('Thanks for the kind words.')
    await controller.submit()

    expect(savedTexts()).toEqual(['Thanks for the kind words.'])
    expect(replyServer.submitReplyFn).toHaveBeenCalledTimes(1)
  })

  it('waits for a save in flight and does not save the same text twice', async () => {
    const { controller } = openComposer()
    const inFlight = Promise.withResolvers<unknown>()
    replyServer.draftReplyFn.mockReturnValueOnce(inFlight.promise)
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    const submitted = controller.submit()
    await pane.settle()
    expect(replyServer.submitReplyFn).not.toHaveBeenCalled()
    inFlight.resolve({
      ...savedReply,
      text: 'Thanks for the kind words.',
      stateRevision: 9,
    })
    await submitted

    expect(savedTexts()).toEqual(['Thanks for the kind words.'])
    expect(replyServer.submitReplyFn).toHaveBeenCalledTimes(1)
  })

  it('does not submit after a failed save, and says so in the autosave state', async () => {
    const { controller } = openComposer()
    replyServer.draftReplyFn.mockRejectedValue(new TypeError('Failed to fetch'))

    controller.typeText('Thanks for the kind words.')
    await controller.submit()

    expect(replyServer.submitReplyFn).not.toHaveBeenCalled()
    expect(controller.getSnapshot().autosave.status).toBe('error')
  })
})

describe('blur and language', () => {
  it('flushes a valid draft on blur', async () => {
    const { controller } = openComposer()

    controller.typeText('Thanks for the kind words.')
    controller.blur()
    await pane.settle()

    expect(savedTexts()).toEqual(['Thanks for the kind words.'])
  })

  it('commits a language without telling the stream, saves it at once, and returns the scope', async () => {
    const { controller, calls } = openComposer({ propertyLanguage: 'bg-Cyrl' })

    const scope = controller.updateLanguage('en-Latn')
    await pane.settle()

    expect(calls).toEqual(['dismiss(false)', 'clearLoaded'])
    expect(scope.draft.languageTag).toBe('en-Latn')
    expect(controller.getSnapshot().selectedLanguage).toBe('en-Latn')
    expect(controller.revision.current).toBe(1)
  })

  it('asks for a regenerate in the other language without committing it', async () => {
    const { controller, request } = openComposer()

    await controller.regenerateIn('tr-Latn')

    expect(request.mock.calls[0]?.[2]?.draft.languageTag).toBe('tr-Latn')
    expect(controller.getSnapshot().draft.languageTag).toBe('en-Latn')
  })
})

describe('navigation teardown', () => {
  it('sends text typed inside the pause when the composer unmounts', async () => {
    const { controller, disconnect } = openComposer()

    controller.typeText('Typed just before leaving.')
    disconnect()
    await pane.settle()

    expect(savedTexts()).toEqual(['Typed just before leaving.'])
  })

  it('reports save state again after a teardown and a second connect', async () => {
    const { controller, disconnect } = openComposer()

    disconnect()
    controller.connect()
    controller.typeText('Typed after the remount.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(savedTexts()).toEqual(['Typed after the remount.'])
    expect(controller.getSnapshot().autosave.status).toBe('saved')
  })
})

// Delete draft removes the reply on the server and empties the box to match.
describe('a saved draft deleted while the composer stays open', () => {
  it('empties the box, shows no Saved state and drops the undo history', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    await controller.deleteDraft(actions.deleteDraft)

    const after = controller.getSnapshot()
    expect(replyServer.deleteReplyFn).toHaveBeenCalledTimes(1)
    expect(after.draft.text).toBe('')
    expect(after.autosave).toEqual({ status: 'idle', error: null })
    expect(after.history).toEqual([])
    controller.undo()
    expect(controller.getSnapshot().draft.text).toBe('')
  })

  it('sends the revision the screen holds with the delete', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    await controller.deleteDraft(actions.deleteDraft)

    expect(replyServer.deleteReplyFn).toHaveBeenCalledWith({
      data: { reviewId: REVIEW_ID, expectedReply: { id: 'reply-1', stateRevision: 2 } },
    })
  })

  it('leaves the box and autosave alone when the delete fails', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    const before = controller.getSnapshot()
    replyServer.deleteReplyFn.mockRejectedValueOnce(new Error('delete failed'))

    await expect(controller.deleteDraft(actions.deleteDraft)).rejects.toThrow(
      'delete failed',
    )

    expect(controller.getSnapshot()).toBe(before)
    expect(before.draft.text).toBe('Thanks for the kind words.')
    expect(before.autosave.status).toBe('saved')
  })

  it('does not treat the deleted text as saved when it is typed again', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await controller.deleteDraft(actions.deleteDraft)
    replyServer.draftReplyFn.mockClear()

    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(savedTexts()).toEqual(['Thanks for the kind words.'])
    expect(controller.getSnapshot().autosave.status).toBe('saved')
  })

  it('sends no held edit after the delete when a save was in flight', async () => {
    const { controller, actions } = openComposer()
    const order: string[] = []
    let releaseFirstSave: () => void = () => undefined
    let revision = 1
    replyServer.draftReplyFn.mockImplementation(
      async ({ data }: { data: { text: string } }) => {
        order.push(`save:${data.text}`)
        if (order.length === 1)
          await new Promise<void>((resolve) => {
            releaseFirstSave = resolve
          })
        return { ...savedReply, text: data.text, stateRevision: ++revision }
      },
    )
    replyServer.deleteReplyFn.mockImplementation(async () => {
      order.push('delete')
    })
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    controller.typeText('Thanks for the kind words, truly.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    const deleting = controller.deleteDraft(actions.deleteDraft)
    releaseFirstSave()
    await deleting
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)

    expect(order).toEqual(['save:Thanks for the kind words.', 'delete'])
    expect(controller.getSnapshot().draft.text).toBe('')
  })

  it('writes the held edit again when the delete fails', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    controller.typeText('Thanks for the kind words, truly.')
    replyServer.deleteReplyFn.mockRejectedValueOnce(new Error('delete failed'))
    replyServer.draftReplyFn.mockClear()

    await expect(controller.deleteDraft(actions.deleteDraft)).rejects.toThrow(
      'delete failed',
    )
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(savedTexts()).toEqual(['Thanks for the kind words, truly.'])
  })

  it('saves further typing as a new draft', async () => {
    const { controller, actions } = openComposer()
    controller.typeText('Thanks for the kind words.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await controller.deleteDraft(actions.deleteDraft)
    replyServer.draftReplyFn.mockClear()

    controller.typeText('Thanks, truly.')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(savedTexts()).toEqual(['Thanks, truly.'])
    expect(controller.getSnapshot().autosave.status).toBe('saved')
  })
})
