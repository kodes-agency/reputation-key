import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_RESULTS_RANGE_STORAGE_KEY } from '../portal-analytics/portal-results-window'
import { readOverviewRange, rememberOverviewRange } from './overview-range-store'

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

describe('overview range store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the default when nothing is stored', () => {
    expect(readOverviewRange()).toBe('30d')
  })

  it('remembers a pick in storage', () => {
    rememberOverviewRange('7d')
    expect(localStorage.getItem(PORTAL_RESULTS_RANGE_STORAGE_KEY)).toBe('7d')
    expect(readOverviewRange()).toBe('7d')
  })

  it('follows a range the Results tab writes after the overview picked one', () => {
    rememberOverviewRange('7d')
    localStorage.setItem(PORTAL_RESULTS_RANGE_STORAGE_KEY, '90d')
    expect(readOverviewRange()).toBe('90d')
  })

  it('keeps the pick for this page when storage refuses writes', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      }),
    )
    rememberOverviewRange('60d')
    expect(readOverviewRange()).toBe('60d')
  })

  it('keeps the pick for this page when storage cannot be read at all', () => {
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
    rememberOverviewRange('7d')
    expect(readOverviewRange()).toBe('7d')
  })

  it('drops the page-only pick once storage takes a write again', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      }),
    )
    rememberOverviewRange('60d')
    vi.stubGlobal('localStorage', memoryStorage())
    rememberOverviewRange('7d')
    localStorage.setItem(PORTAL_RESULTS_RANGE_STORAGE_KEY, '90d')
    expect(readOverviewRange()).toBe('90d')
  })
})
