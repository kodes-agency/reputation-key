import { act, createElement } from 'react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { ReplyDraftCheckDto } from '#/contexts/review/application/dto/reply-library.dto'
import type { CheckReplyDraft } from './use-reply-draft-checks'

const CLEAR: ReplyDraftCheckDto = {
  blocks: [],
  warnings: [],
  maxSimilarity: 0,
  similar: false,
}

const fakeDocument = () => {
  const doc = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const view = {
    document: doc,
    setTimeout: (callback: TimerHandler, delay?: number) => setTimeout(callback, delay),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    HTMLIFrameElement: class {},
  }
  return Object.assign(doc, { defaultView: view })
}

describe('useReplyDraftChecks', () => {
  let root: { render(node: unknown): void; unmount(): void } | undefined
  let createRoot: typeof import('react-dom/client').createRoot
  let useReplyDraftChecks: typeof import('./use-reply-draft-checks').useReplyDraftChecks
  let doc: ReturnType<typeof fakeDocument>
  let latest: ReplyDraftCheckDto | null = null

  beforeAll(async () => {
    doc = fakeDocument()
    vi.stubGlobal('window', doc.defaultView)
    vi.stubGlobal('document', doc)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    ;({ createRoot } = await import('react-dom/client'))
    ;({ useReplyDraftChecks } = await import('./use-reply-draft-checks'))
  })

  afterAll(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.useFakeTimers()
    latest = null
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    vi.useRealTimers()
  })

  const container = () => ({
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })

  async function show(text: string, check: CheckReplyDraft | undefined) {
    const Probe = () => {
      latest = useReplyDraftChecks(text, check)
      return null
    }
    root ??= createRoot(container() as unknown as Element)
    await act(async () => root!.render(createElement(Probe)))
  }

  it('does not restart when a mutation rerender supplies a new callback closure', async () => {
    const first = vi.fn(async () => CLEAR)
    const latestCheck = vi.fn(async () => CLEAR)
    await show('A settled reply', first)
    await show('A settled reply', latestCheck)

    await act(async () => vi.advanceTimersByTimeAsync(600))

    expect(first).not.toHaveBeenCalled()
    expect(latestCheck).toHaveBeenCalledTimes(1)
    expect(latest).toEqual(CLEAR)
  })

  it('checks once per settled non-empty text and drops a stale answer', async () => {
    let resolveFirst: ((value: ReplyDraftCheckDto) => void) | undefined
    const check = vi.fn((text: string) =>
      text === 'First'
        ? new Promise<ReplyDraftCheckDto>((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve(CLEAR),
    )
    await show('First', check)
    await act(async () => vi.advanceTimersByTimeAsync(600))
    await show('Second', check)
    resolveFirst?.({ ...CLEAR, similar: true, maxSimilarity: 0.9 })
    await act(async () => Promise.resolve())
    expect(latest).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(check).toHaveBeenCalledTimes(2)
    expect(latest).toEqual(CLEAR)
  })

  it('does not check blank text', async () => {
    const check = vi.fn(async () => CLEAR)
    await show('   ', check)
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(check).not.toHaveBeenCalled()
  })
})
