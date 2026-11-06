import { afterEach, describe, expect, it, vi } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { loadCsf } from 'storybook/internal/csf-tools'
import config from './main'

const baseline = [
  {
    storyId: 'forms-save--pending',
    state: 'Pending',
    width: 320,
    checks: ['targets'],
  },
  {
    storyId: 'forms-save--pending',
    state: 'Pending',
    width: 390,
    checks: ['targets'],
  },
]

async function setup(record = '') {
  vi.resetModules()
  vi.stubEnv('PHONE_WIDTH_RECORD', record)
  type Context = {
    task: {
      id: string
      name: string
      file: { id: string }
      meta: Record<string, unknown>
    }
  }
  type Hook = (context: Context) => unknown
  const starts: Hook[] = []
  const finishes: Hook[] = []
  vi.doMock('vitest', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vitest')>()),
    beforeEach: (hook: Hook) => starts.push(hook),
    afterEach: (hook: Hook) => finishes.push(hook),
  }))
  const view = {
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
    getComputedStyle: () => ({ display: 'block', content: 'none' }),
  }
  const doc = {
    defaultView: view,
    createElement: () => ({ remove: vi.fn() }),
    head: { append: vi.fn() },
    body: { append: vi.fn(), querySelectorAll: () => [] },
    documentElement: { scrollWidth: 0 },
    querySelectorAll: vi.fn((): Element[] => []),
    fonts: { ready: Promise.resolve() },
  }
  Object.assign(view, { document: doc })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('getComputedStyle', () => ({ display: 'none' }))
  vi.stubGlobal('FRAMEWORK_OPTIONS', undefined)
  const viewport = vi.fn(async (width: number, height: number) => {
    view.innerWidth = width
    view.innerHeight = height
  })
  const storybookStoryStarts = vi.fn()
  const recordPhoneWidthFailures = vi.fn()
  vi.doMock('vitest/browser', () => ({
    commands: { storybookStoryStarts, recordPhoneWidthFailures },
    page: { viewport },
  }))
  vi.doMock('./phone-width-failures.json', () => ({
    default: baseline,
  }))
  await import('./vitest.setup')

  const context = (storyId: string, state: string): Context => ({
    task: {
      id: 'test-id',
      name: state,
      file: { id: 'file-id' },
      meta: { storyId },
    },
  })
  const finish = async (ctx: Context) => {
    for (const hook of finishes) await hook(ctx)
  }
  const smallTarget = () => {
    const control = {
      tagName: 'BUTTON',
      textContent: 'Save',
      getAttribute: () => null,
      closest: () => null,
      checkVisibility: () => true,
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ width: 60, height: 36 }),
    }
    vi.mocked(doc.querySelectorAll).mockReturnValue([control as unknown as Element])
  }
  return {
    starts,
    finish,
    context,
    doc,
    viewport,
    smallTarget,
    storybookStoryStarts,
    recordPhoneWidthFailures,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.doUnmock('vitest')
  vi.doUnmock('vitest/browser')
  vi.doUnmock('./phone-width-failures.json')
  Reflect.deleteProperty(globalThis, Symbol.for('repkey.phone-width.set-viewport'))
})

describe('Storybook global phone-width gate', () => {
  it('sends both checks at both widths to the shrink-only recorder', async () => {
    const { finish, context, doc, smallTarget, recordPhoneWidthFailures } =
      await setup('1')
    smallTarget()
    doc.documentElement.scrollWidth = 410
    const ctx = context('forms-save--new', 'New')

    await expect(finish(ctx)).resolves.toBeUndefined()
    expect(recordPhoneWidthFailures).toHaveBeenCalledExactlyOnceWith({
      storyId: 'forms-save--new',
      state: 'New',
      measurements: [320, 390].map((width) => ({
        width,
        overflow: [`the page scrolls sideways: 410 px wide in ${width} px`],
        targets: ['Save is 60x36; a target is at least 44 px'],
      })),
    })
  })

  it('records passing states so regeneration can remove repaired baseline entries', async () => {
    const { finish, context, recordPhoneWidthFailures } = await setup('1')
    const ctx = context('forms-save--pending', 'Pending')
    await expect(finish(ctx)).resolves.toBeUndefined()
    expect(recordPhoneWidthFailures).toHaveBeenCalledExactlyOnceWith(
      ctx.task.meta.phoneWidth,
    )
  })

  it.each(['', '0', 'true'])(
    'keeps the comparison and never writes with record=%s',
    async (record) => {
      const { finish, context, smallTarget, recordPhoneWidthFailures } =
        await setup(record)
      smallTarget()
      await expect(finish(context('forms-save--new', 'New'))).rejects.toThrow(/targets/)
      expect(recordPhoneWidthFailures).not.toHaveBeenCalled()
    },
  )

  it('still rejects unexpected console errors in record mode', async () => {
    const { starts, finish, context, smallTarget, recordPhoneWidthFailures } =
      await setup('1')
    const ctx = context('forms-save--new', 'New')
    await starts[2]!(ctx)
    smallTarget()
    console.error('unexpected render failure')
    await expect(finish(ctx)).rejects.toThrow(
      /Unexpected console.error.*unexpected render failure/s,
    )
    expect(recordPhoneWidthFailures).toHaveBeenCalledOnce()
    expect(vi.isMockFunction(console.error)).toBe(false)
  })

  it('fails when recording cannot persist its observations', async () => {
    const { finish, context, recordPhoneWidthFailures } = await setup('1')
    recordPhoneWidthFailures.mockRejectedValue(new Error('Cannot write inventory'))
    await expect(finish(context('forms-save--new', 'New'))).rejects.toThrow(
      'Cannot write inventory',
    )
  })

  it('checks every indexed story state, including stories without a play function', async () => {
    const { finish, context, viewport } = await setup()
    const patterns = config.stories
    if (!Array.isArray(patterns)) throw new Error('Expected configured story globs')
    const stories = patterns.flatMap((pattern) => {
      if (typeof pattern !== 'string') throw new Error('Expected a story glob')
      return globSync(pattern, { cwd: import.meta.dirname }).flatMap(
        (fileName) =>
          loadCsf(readFileSync(new URL(fileName, import.meta.url), 'utf8'), {
            fileName,
            makeTitle: (title) => title,
          }).parse().stories,
      )
    })
    expect(stories.length).toBeGreaterThan(0)
    expect(stories.some((story) => !story.tags?.includes('play-fn'))).toBe(true)
    for (const story of stories) {
      const ctx = context(story.id, story.name)
      await finish(ctx)
      expect(ctx.task.meta.phoneWidth, story.id).toEqual({
        storyId: story.id,
        state: story.name,
        measurements: [
          { width: 320, overflow: [], targets: [] },
          { width: 390, overflow: [], targets: [] },
        ],
      })
    }
    expect(viewport).toHaveBeenCalledTimes(stories.length * 3)
  })

  it('checks every state without needing a play function or a phone-check opt-in', async () => {
    const { finish, context, viewport } = await setup()
    for (const state of ['Default', 'Loading', 'Empty', 'Error']) {
      await finish(context(`pages-list--${state.toLowerCase()}`, state))
    }
    expect(viewport.mock.calls).toEqual(
      Array.from({ length: 4 }, () => [
        [320, 900],
        [390, 900],
        [1200, 800],
      ]).flat(),
    )
  })

  it('rejects an unlisted state with a small target and restores the viewport', async () => {
    const { finish, context, smallTarget, viewport } = await setup()
    smallTarget()
    await expect(finish(context('forms-save--error', 'Error'))).rejects.toThrow(
      /forms-save--error.*Error.*320 px.*targets.*Save/s,
    )
    expect(viewport).toHaveBeenLastCalledWith(1200, 800)
  })

  it('uses the stable story id and state to accept only recorded failing checks', async () => {
    const { finish, context, smallTarget } = await setup()
    smallTarget()
    await expect(
      finish(context('forms-save--pending', 'Pending')),
    ).resolves.toBeUndefined()
    await expect(finish(context('forms-save--pending', 'Error'))).rejects.toThrow(
      /targets/,
    )
    await expect(finish(context('forms-save--other', 'Pending'))).rejects.toThrow(
      /targets/,
    )
  })

  it('propagates the recorder rejection for a new failure', async () => {
    const { finish, context, smallTarget, recordPhoneWidthFailures } = await setup('1')
    smallTarget()
    recordPhoneWidthFailures.mockRejectedValue(
      new Error('New phone-width failure: forms-save--new, 320 px, targets'),
    )
    await expect(finish(context('forms-save--new', 'New'))).rejects.toThrow(
      /New phone-width failure.*targets/,
    )
  })

  it('prints every passing listed check without failing', async () => {
    const { finish, context } = await setup()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await expect(
        finish(context('forms-save--pending', 'Pending')),
      ).resolves.not.toThrow()
      expect(info).toHaveBeenCalledExactlyOnceWith(
        '[phone-width] passes now; the next record run drops it: forms-save--pending (Pending), 320 px, targets; forms-save--pending (Pending), 390 px, targets',
      )
    } finally {
      info.mockRestore()
    }
  })

  it('reports passing checks while rejecting an unlisted failure', async () => {
    const { finish, context, doc } = await setup()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    doc.documentElement.scrollWidth = 340
    await expect(finish(context('forms-save--pending', 'Pending'))).rejects.toThrow(
      /320 px.*overflow.*340 px/s,
    )
    expect(info).toHaveBeenCalledExactlyOnceWith(
      '[phone-width] passes now; the next record run drops it: forms-save--pending (Pending), 320 px, targets; forms-save--pending (Pending), 390 px, targets',
    )
  })

  it('keeps the console-error gate when listed checks pass', async () => {
    const { starts, finish, context } = await setup()
    const ctx = context('forms-save--pending', 'Pending')
    await starts[2]!(ctx)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    console.error('unexpected render failure')
    await expect(finish(ctx)).rejects.toThrow(
      /Unexpected console.error.*unexpected render failure/s,
    )
    expect(info).toHaveBeenCalledOnce()
    expect(vi.isMockFunction(console.error)).toBe(false)
  })

  it('rejects new overflow even when the state already has small targets', async () => {
    const { finish, context, doc, smallTarget } = await setup()
    smallTarget()
    doc.documentElement.scrollWidth = 340
    await expect(finish(context('forms-save--pending', 'Pending'))).rejects.toThrow(
      /320 px.*overflow.*340 px/s,
    )
  })

  it('refuses an unidentified story instead of silently leaving it unchecked', async () => {
    const { finish, context } = await setup()
    const ctx = context('forms-save--default', 'Default')
    delete ctx.task.meta.storyId
    await expect(finish(ctx)).rejects.toThrow(/story id/i)
  })

  it('keeps the stall-guard notification before rendering', async () => {
    const { starts, context, storybookStoryStarts } = await setup()
    await starts[0]!(context('forms-save--default', 'Default'))
    expect(storybookStoryStarts).toHaveBeenCalledWith({
      fileId: 'file-id',
      testId: 'test-id',
    })
  })

  it('records complete observations even when the comparison rejects a new finding', async () => {
    const { finish, context, smallTarget } = await setup()
    const ctx = context('forms-save--new', 'New')
    smallTarget()
    await expect(finish(ctx)).rejects.toThrow(/targets/)
    expect(ctx.task.meta.phoneWidth).toEqual({
      storyId: 'forms-save--new',
      state: 'New',
      measurements: [320, 390].map((width) => ({
        width,
        overflow: [],
        targets: ['Save is 60x36; a target is at least 44 px'],
      })),
    })
  })

  it('preserves the console-error gate alongside a phone-width failure', async () => {
    const { starts, finish, context, smallTarget } = await setup()
    const ctx = context('forms-save--new', 'New')
    await starts[2]!(ctx)
    smallTarget()
    console.error('unexpected render failure')
    const result = finish(ctx)
    await expect(result).rejects.toThrow(/targets/)
    await expect(result).rejects.toThrow(
      /Unexpected console.error.*unexpected render failure/s,
    )
    expect(vi.isMockFunction(console.error)).toBe(false)
  })

  it('preserves the immediate update-loop guard', async () => {
    const { starts, context } = await setup()
    await starts[2]!(context('forms-save--new', 'New'))
    expect(() => console.error('Maximum update depth exceeded')).toThrow(
      'Maximum update depth exceeded',
    )
  })

  it('still requires compiled CSS and enables StrictMode before stories load', async () => {
    const { starts, context } = await setup()
    expect(Reflect.get(globalThis, 'FRAMEWORK_OPTIONS')).toEqual({ strictMode: true })
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block' }))
    expect(() => starts[1]!(context('forms-save--new', 'New'))).toThrow(
      /Stories must load compiled src\/styles.css/,
    )
  })
})
