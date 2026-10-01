import { describe, expect, test } from 'vitest'
import { accountForStories, type StoryIndexEntry } from './story-accounting'

const entry = (id: string, title: string, importPath: string): StoryIndexEntry => ({
  id,
  type: 'story',
  title,
  importPath,
})

const IMMERSIVE = './src/components/features/guest/public-portal/immersive/'
const index: ReadonlyArray<StoryIndexEntry> = [
  entry('shell--arrival', 'Guest/Shell', `${IMMERSIVE}shell.stories.tsx`),
  entry('shell--no-photo', 'Guest/Shell', `${IMMERSIVE}shell.stories.tsx`),
  entry(
    'legacy--default',
    'Guest/Legacy',
    './src/components/features/guest/legacy.stories.tsx',
  ),
  entry('inbox--list', 'Inbox/List', './src/components/inbox/list.stories.tsx'),
  {
    id: 'shell--docs',
    type: 'docs',
    title: 'Guest/Shell',
    importPath: `${IMMERSIVE}shell.stories.tsx`,
  },
]

const base = {
  entries: index,
  importPrefixes: ['./src/components/features/guest/'],
  measured: ['shell--arrival', 'shell--no-photo'],
  excludedIds: {},
  excludedTitles: { 'Guest/Legacy': 'the legacy renderer' },
}

describe('accountForStories', () => {
  test('finds nothing wrong when every story is measured or excluded with a reason', () => {
    expect(accountForStories(base)).toEqual({
      missing: [],
      unaccounted: [],
      contradictions: [],
      staleExclusions: [],
    })
  })

  test('reports a new story in the measured area that nobody declared', () => {
    const result = accountForStories({ ...base, measured: ['shell--arrival'] })
    expect(result.unaccounted).toEqual([
      `shell--no-photo (Guest/Shell, ${IMMERSIVE}shell.stories.tsx)`,
    ])
  })

  test('reports a declared id that no story has any more', () => {
    const result = accountForStories({
      ...base,
      measured: [...base.measured, 'shell--renamed'],
    })
    expect(result.missing).toEqual(['shell--renamed'])
  })

  test('leaves stories outside the import prefixes alone', () => {
    const result = accountForStories(base)
    expect(result.unaccounted.join()).not.toContain('inbox--list')
  })

  test('does not count a docs entry as a story', () => {
    const result = accountForStories({
      ...base,
      measured: ['shell--arrival', 'shell--no-photo'],
    })
    expect(result.unaccounted).toEqual([])
  })

  test('reports an id that is both measured and under an excluded title', () => {
    const result = accountForStories({
      ...base,
      measured: [...base.measured, 'legacy--default'],
    })
    expect(result.contradictions).toHaveLength(1)
    expect(result.contradictions[0]).toContain('legacy--default')
  })

  test('reports an excluded title that matches no story', () => {
    const result = accountForStories({
      ...base,
      excludedTitles: { ...base.excludedTitles, 'Guest/Gone': 'was removed' },
    })
    expect(result.staleExclusions).toEqual(['Guest/Gone'])
  })

  test('accepts an id excluded by name', () => {
    const result = accountForStories({
      ...base,
      measured: ['shell--arrival'],
      excludedIds: { 'shell--no-photo': 'measured by another file' },
    })
    expect(result.unaccounted).toEqual([])
    expect(result.missing).toEqual([])
  })
})
