import { describe, expect, it } from 'vitest'
import { OVERVIEW_CLASSES } from './portal-overview-density'

const classesOf = (density: keyof typeof OVERVIEW_CLASSES) =>
  Object.entries(OVERVIEW_CLASSES[density])

describe('OVERVIEW_CLASSES', () => {
  it('has the same parts at both densities', () => {
    expect(Object.keys(OVERVIEW_CLASSES.compact)).toEqual(
      Object.keys(OVERVIEW_CLASSES.regular),
    )
  })

  it('turns the regular table on at 56 rem and the compact one at 42 rem, and never mixes them', () => {
    for (const [part, classes] of classesOf('regular')) {
      expect(classes, part).not.toMatch(/@2xl:/)
    }
    for (const [part, classes] of classesOf('compact')) {
      expect(classes, part).not.toMatch(/@4xl:/)
    }
    expect(OVERVIEW_CLASSES.regular.table).toBe('block @4xl:table')
    expect(OVERVIEW_CLASSES.compact.table).toBe('block @2xl:table')
  })

  it('lays out the same table: every part that is a table cell at one density is at the other', () => {
    for (const part of Object.keys(OVERVIEW_CLASSES.regular) as Array<
      keyof typeof OVERVIEW_CLASSES.regular
    >) {
      const regular = OVERVIEW_CLASSES.regular[part]
        .split(' ')
        .filter((c) => c.includes('table'))
      const compact = OVERVIEW_CLASSES.compact[part]
        .split(' ')
        .filter((c) => c.includes('table'))
        .map((c) => c.replace('@2xl:', '@4xl:'))
      expect(compact, part).toEqual(regular)
    }
  })

  it('shows Share as an icon only in the compact table', () => {
    expect(OVERVIEW_CLASSES.regular.shareLabel).toBe('')
    expect(OVERVIEW_CLASSES.compact.shareLabel).toBe('@2xl:sr-only')
  })
})
