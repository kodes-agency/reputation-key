import { describe, expect, it } from 'vitest'
import { OVERVIEW_CLASSES, OVERVIEW_FROM } from './portal-overview-density'

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
    expect(OVERVIEW_FROM).toEqual({ regular: '4xl', compact: '2xl' })
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

  it('says only the compact table drops the words of Share, which is what gives it a tooltip', () => {
    // `ShareButton` reads "no label class" as "the words stay"; a density that
    // hid them some other way would lose its tooltip without this noticing.
    expect(OVERVIEW_CLASSES.regular.shareLabel === '').toBe(true)
    expect(OVERVIEW_CLASSES.compact.shareLabel).not.toBe('')
  })
})
