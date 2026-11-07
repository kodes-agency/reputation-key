import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeStory, type StoryContext } from '@storybook/react'
import { createElement } from 'react'
import { playInThemes } from './play-in-themes'

const { events, accessibility, phone, clearMocks } = vi.hoisted(() => {
  const events: string[] = []
  return {
    events,
    accessibility: vi.fn(async (context: StoryContext) => {
      events.push(`axe:${context.parameters.theme}`)
    }),
    phone: vi.fn(async () => {
      events.push('phone')
    }),
    clearMocks: vi.fn(() => events.push('clear mocks')),
  }
})
vi.mock('@storybook/addon-a11y/preview', () => ({ afterEach: accessibility }))
vi.mock('../src/shared/testing/phone-width', () => ({ checkPhoneWidths: phone }))
vi.mock('storybook/test', () => ({ clearAllMocks: clearMocks }))

function setup() {
  let value = 0
  const context = {
    parameters: { theme: 'dark', a11y: { test: 'error' } },
    canvasElement: { ownerDocument: {} },
    mount: vi.fn(async () => {
      value = 0
      events.push(`mount:${context.parameters.theme}`)
    }),
    step: async (name: string, run: () => Promise<void>) => {
      events.push(name)
      await run()
    },
  } as unknown as StoryContext
  const play = vi.fn(async (current: StoryContext) => {
    expect(value++).toBe(0)
    events.push(`play:${current.parameters.theme}`)
  })
  return { context, play }
}

beforeEach(() => {
  vi.resetAllMocks()
  events.length = 0
})

afterEach(() => vi.unstubAllEnvs())

describe('a story checked in both themes', () => {
  it('uses Storybook manual mounting and forces a fresh render in each theme', async () => {
    const themes: unknown[] = []
    const renderToCanvas = vi.fn(async ({ storyContext, forceRemount }) => {
      expect(forceRemount).toBe(true)
      themes.push(storyContext.parameters.theme)
      return () => undefined
    })
    const story = composeStory(
      { play: playInThemes() },
      { title: 'Test/Themed state', render: () => createElement('div') },
      { renderToCanvas },
    )
    await story.run({ canvasElement: { ownerDocument: {} } as HTMLElement })
    expect(themes).toEqual(['light', 'dark'])
    expect(renderToCanvas).toHaveBeenCalledTimes(2)
  })

  it('remounts and repeats interactions, accessibility and both phone widths per theme', async () => {
    const { context, play } = setup()
    await playInThemes(play)(context)
    expect(events).toEqual([
      'light',
      'clear mocks',
      'mount:light',
      'play:light',
      'axe:light',
      'phone',
      'dark',
      'clear mocks',
      'mount:dark',
      'play:dark',
      'axe:dark',
      'phone',
    ])
    expect(context.parameters.theme).toBe('dark')
    expect(accessibility).toHaveBeenCalledTimes(2)
    expect(phone).toHaveBeenCalledTimes(2)
  })

  it('leaves a light preview in its original theme too', async () => {
    const { context } = setup()
    context.parameters.theme = 'light'
    await playInThemes()(context)
    expect(context.parameters.theme).toBe('light')
    expect(events.filter((event) => event.startsWith('mount:'))).toEqual([
      'mount:dark',
      'mount:light',
    ])
  })

  it('keeps ordinary desktop previews usable without the runner viewport setter', async () => {
    vi.stubEnv('MODE', 'development')
    const { context, play } = setup()
    await playInThemes(play)(context)
    expect(play).toHaveBeenCalledTimes(2)
    expect(accessibility).toHaveBeenCalledTimes(2)
    expect(phone).not.toHaveBeenCalled()
  })

  it('checks static stories that have no interactions', async () => {
    const { context } = setup()
    await playInThemes()(context)
    expect(context.mount).toHaveBeenCalledTimes(2)
    expect(accessibility).toHaveBeenCalledTimes(2)
    expect(phone).toHaveBeenCalledTimes(2)
  })

  it.each(['dark', 'light'])('fails when an interaction breaks in %s', async (theme) => {
    const { context } = setup()
    await expect(
      playInThemes(async (current) => {
        if (current.parameters.theme === theme) throw new Error('Broken interaction')
      })(context),
    ).rejects.toThrow('Broken interaction')
  })

  it.each(['dark', 'light'])('fails when accessibility breaks in %s', async (theme) => {
    const { context } = setup()
    accessibility.mockImplementation(async (current) => {
      if (current.parameters.theme === theme) throw new Error('Contrast failure')
    })
    await expect(playInThemes()(context)).rejects.toThrow('Contrast failure')
  })

  it.each(['dark', 'light'])('fails when a phone check breaks in %s', async (theme) => {
    const { context } = setup()
    phone.mockImplementation(async () => {
      if (context.parameters.theme === theme) throw new Error('Undersized target')
    })
    await expect(playInThemes()(context)).rejects.toThrow('Undersized target')
  })
})
