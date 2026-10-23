import { describe, expect, it } from 'vitest'
import { longCopySizes, scaleSizes } from './portal-print-kit-long-copy'
import { TYPE_FLOOR_PT, TYPE_PT } from './portal-print-kit-measures'

describe('scaleSizes', () => {
  it('reads a scale’s sizes, and none for a second language one language does not have', () => {
    expect(scaleSizes('twoTight')).toEqual(TYPE_PT.twoTight)
    expect(scaleSizes('one')).toEqual({ ...TYPE_PT.one, place2: 0, head2: 0, sub2: 0 })
  })
})

describe('longCopySizes', () => {
  it('shrinks the place label to its 21 pt floor, then the second language to its floors, then the place label alone', () => {
    const steps = longCopySizes('twoTight')
    expect(steps.slice(0, 2).map((sizes) => sizes.place)).toEqual([21.5, 21])
    expect(steps[2]).toEqual({
      ...TYPE_PT.twoTight,
      place: 21,
      place2: 9,
      head2: 11.5,
      sub2: 9,
    })
    expect(steps[3]).toEqual({ ...steps[2], place: 20.5 })
    expect(steps.at(-1)).toEqual({ ...steps[2], place: TYPE_FLOOR_PT.read })
  })

  it('steps the second language down half a point at a time, each part to its own floor', () => {
    const steps = longCopySizes('tent')
    const second = steps.filter((sizes) => sizes.place === TYPE_PT.tent.head)
    expect(second.map((sizes) => [sizes.head2, sizes.sub2, sizes.place2])).toEqual([
      [16, 11.5, 12],
      [15.5, 11, 11.5],
      [15, 10.5, 11],
      [14.5, 10, 10.5],
      [14, 9.5, 10],
      [13.5, 9, 9.5],
      [13, 9, 9],
      [12.5, 9, 9],
      [12, 9, 9],
      [11.5, 9, 9],
    ])
  })

  it('keeps the place label the largest type until the last resort: never under the lead headline before it', () => {
    for (const scale of ['two', 'twoTight', 'one', 'tent'] as const) {
      const steps = longCopySizes(scale)
      const lastResort = steps.findIndex(
        (sizes) => sizes.place < Math.max(TYPE_FLOOR_PT.place, sizes.head),
      )
      const before = steps.slice(0, lastResort)
      for (const sizes of before) {
        expect(sizes.place).toBeGreaterThanOrEqual(sizes.head)
        expect(sizes.place).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.place)
      }
      // The second language is at its floors before the place label goes under its own.
      expect(steps[lastResort]?.head2 ?? 0).toBeLessThanOrEqual(TYPE_FLOOR_PT.head2)
    }
  })

  it('never sets anything a guest reads under 9 pt, and ends with every part at its floor', () => {
    for (const scale of ['two', 'twoTight', 'one', 'tent'] as const) {
      for (const sizes of longCopySizes(scale)) {
        expect(sizes.place).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
        expect(sizes.head).toBe(TYPE_PT[scale].head)
        expect(sizes.sub).toBe(TYPE_PT[scale].sub)
      }
      expect(longCopySizes(scale).at(-1)?.place).toBe(TYPE_FLOOR_PT.read)
    }
  })

  it('shrinks one language’s place label from 32 pt to 9 pt, as before', () => {
    const places = longCopySizes('one').map((sizes) => sizes.place)
    expect(places[0]).toBe(31.5)
    expect(places).toHaveLength((32 - 9) / 0.5)
  })
})
