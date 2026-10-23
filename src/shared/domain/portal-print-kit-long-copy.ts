// The long-copy steps (spec 2.2 and 2.5): what a face's words give up once
// every fit step is used up and they still reach the code block, which never
// gives way. A Portal's title may run to 120 characters, and a French or German
// call to action is longer than the English. Each step is taken only once the
// one before is used up:
//
//   1. the place label shrinks to its floor: 21 pt, and never under the lead
//      headline, so it stays the largest type on the face;
//   2. the second language's block steps down to its floors, half a point at a
//      time: the second headline to 11.5 pt, its subline and title to 9 pt;
//   3. last, the place label shrinks under its floor, down to 9 pt. Only here
//      may the rank order give way: the words never reach the code.
//
// Pure and shared: the PDF measures each step with the fonts, the Share tab's
// preview estimates them, and both walk the same list.

import { TYPE_FLOOR_PT, TYPE_PT, type TypeScale } from './portal-print-kit-measures'

/** Every size a face's words are set in, in points. */
export type StackSizes = Readonly<{
  place: number
  place2: number
  head: number
  sub: number
  head2: number
  sub2: number
}>

/** A scale's sizes; one language has no second block, so its sizes there are 0. */
export function scaleSizes(scale: TypeScale): StackSizes {
  return { place2: 0, head2: 0, sub2: 0, ...TYPE_PT[scale] }
}

/** How far a size steps down at a time. */
const STEP_PT = 0.5

/** The sizes under `from`, a step at a time, down to `floor`. */
const stepsDown = (from: number, floor: number): readonly number[] =>
  Array.from(
    { length: Math.max(0, Math.round((from - floor) / STEP_PT)) },
    (_, index) => from - (index + 1) * STEP_PT,
  )

const SECOND_FLOORS = {
  head2: TYPE_FLOOR_PT.head2,
  sub2: TYPE_FLOOR_PT.read,
  place2: TYPE_FLOOR_PT.read,
} as const

/** Step 2: the second language's parts down together, each stopping at its own floor. */
function secondLanguageSteps(from: StackSizes): readonly StackSizes[] {
  if (from.head2 === 0) return []
  const parts = Object.keys(SECOND_FLOORS) as (keyof typeof SECOND_FLOORS)[]
  const count = Math.max(
    ...parts.map((part) => stepsDown(from[part], SECOND_FLOORS[part]).length),
  )
  return Array.from({ length: count }, (_, index) => {
    const at = (part: keyof typeof SECOND_FLOORS) =>
      Math.max(SECOND_FLOORS[part], from[part] - (index + 1) * STEP_PT)
    return { ...from, head2: at('head2'), sub2: at('sub2'), place2: at('place2') }
  })
}

/**
 * The sizes a face's words try after its scale's own, roomiest first. The
 * caller takes the first whose words leave the gaps their minimums, or the last
 * when none does, so any overflow is as small as it can be.
 */
export function longCopySizes(scale: TypeScale): readonly StackSizes[] {
  const own = scaleSizes(scale)
  const placeFloor = Math.max(TYPE_FLOOR_PT.place, own.head)
  const toFloor = stepsDown(own.place, placeFloor).map((place) => ({ ...own, place }))
  const second = secondLanguageSteps({ ...own, place: Math.min(own.place, placeFloor) })
  const floors = second.at(-1) ?? toFloor.at(-1) ?? own
  const lastResort = stepsDown(floors.place, TYPE_FLOOR_PT.read).map((place) => ({
    ...floors,
    place,
  }))
  return [...toFloor, ...second, ...lastResort]
}
