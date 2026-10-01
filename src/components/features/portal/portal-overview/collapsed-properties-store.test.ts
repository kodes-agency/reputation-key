import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLAPSED_PROPERTIES_STORAGE_KEY } from './collapsed-properties-store'

type Store = typeof import('./collapsed-properties-store')

// The store keeps a fold storage refused in module state, so each test gets a
// fresh copy rather than the previous test's.
let readCollapsedProperties: Store['readCollapsedProperties']
let toggleCollapsedProperty: Store['toggleCollapsedProperty']

function memoryStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
    ...overrides,
  }
}

const refusing = (): Storage =>
  memoryStorage({
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  })

describe('collapsed properties store', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryStorage())
    ;({ readCollapsedProperties, toggleCollapsedProperty } =
      await import('./collapsed-properties-store'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has every property open when nothing is stored', () => {
    expect(readCollapsedProperties()).toEqual([])
  })

  it('remembers a property the reader folded, and opens it again on the next toggle', () => {
    toggleCollapsedProperty('prop-a')
    expect(readCollapsedProperties()).toEqual(['prop-a'])
    expect(localStorage.getItem(COLLAPSED_PROPERTIES_STORAGE_KEY)).toBe('["prop-a"]')

    toggleCollapsedProperty('prop-b')
    expect(readCollapsedProperties()).toEqual(['prop-a', 'prop-b'])

    toggleCollapsedProperty('prop-a')
    expect(readCollapsedProperties()).toEqual(['prop-b'])
  })

  it('hands back the same list until it changes, so a subscriber does not re-render for nothing', () => {
    toggleCollapsedProperty('prop-a')
    expect(readCollapsedProperties()).toBe(readCollapsedProperties())
  })

  it('follows what another tab stored', () => {
    toggleCollapsedProperty('prop-a')
    localStorage.setItem(COLLAPSED_PROPERTIES_STORAGE_KEY, '["prop-z"]')

    expect(readCollapsedProperties()).toEqual(['prop-z'])
  })

  it.each([
    ['not json', 'nope'],
    ['not a list', '{"a":1}'],
    ['a list of other things', '[1,null,{"a":1}]'],
  ])('ignores a stored value that is %s', (_label, stored) => {
    localStorage.setItem(COLLAPSED_PROPERTIES_STORAGE_KEY, stored)

    expect(readCollapsedProperties()).toEqual([])
  })

  it('keeps only the identifiers of a mixed list', () => {
    localStorage.setItem(COLLAPSED_PROPERTIES_STORAGE_KEY, '["prop-a",3,"prop-b"]')

    expect(readCollapsedProperties()).toEqual(['prop-a', 'prop-b'])
  })

  it('keeps the fold for this page when storage refuses writes', () => {
    vi.stubGlobal('localStorage', refusing())

    toggleCollapsedProperty('prop-a')

    expect(readCollapsedProperties()).toEqual(['prop-a'])
    toggleCollapsedProperty('prop-a')
    expect(readCollapsedProperties()).toEqual([])
  })

  it('keeps the fold for this page when storage cannot be read at all', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('SecurityError')
        },
      }),
    )

    toggleCollapsedProperty('prop-a')

    expect(readCollapsedProperties()).toEqual(['prop-a'])
  })

  it('drops the page-only fold once storage takes a write again', () => {
    vi.stubGlobal('localStorage', refusing())
    toggleCollapsedProperty('prop-a')

    vi.stubGlobal('localStorage', memoryStorage())
    toggleCollapsedProperty('prop-b')

    expect(readCollapsedProperties()).toEqual(['prop-a', 'prop-b'])
    expect(localStorage.getItem(COLLAPSED_PROPERTIES_STORAGE_KEY)).toBe(
      '["prop-a","prop-b"]',
    )
  })
})
