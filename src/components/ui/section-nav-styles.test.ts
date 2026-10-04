// The class lists of a SectionNav are written out whole (Tailwind finds a class
// only that way), so `auto` repeats every `list` class behind the container
// variant. These checks hold the two together.
import { describe, expect, it } from 'vitest'
import {
  SECTION_NAV_LAYOUT,
  SECTION_NAV_LIST_FROM,
  SECTION_NAV_STYLES,
  sectionNavClasses,
  type SectionNavFrame,
  type SectionNavSlot,
} from './section-nav-styles'

const FRAMES = Object.keys(SECTION_NAV_STYLES) as ReadonlyArray<SectionNavFrame>
const SLOTS = Object.keys(SECTION_NAV_STYLES.rail) as ReadonlyArray<SectionNavSlot>

const tokens = (classes: string) => classes.split(/\s+/u).filter(Boolean)

describe.each(FRAMES)('the %s frame', (frame) => {
  const prefix = SECTION_NAV_LIST_FROM[frame]

  it.each(SLOTS)('writes out `auto` as the strip plus the prefixed list: %s', (slot) => {
    const { strip, list, auto } = SECTION_NAV_STYLES[frame][slot]
    const written = tokens(auto)

    const unprefixed = written.filter((token) => !token.startsWith(prefix))
    const prefixed = written
      .filter((token) => token.startsWith(prefix))
      .map((token) => token.slice(prefix.length))

    expect([...unprefixed].sort()).toEqual([...tokens(strip)].sort())
    expect([...prefixed].sort()).toEqual([...tokens(list)].sort())
  })

  it('waits for a container, never the viewport, to become a list', () => {
    const everything = SLOTS.map((slot) => sectionNavClasses(frame, slot, 'auto')).join(
      ' ',
    )

    expect(everything).toContain(prefix)
    expect(everything).not.toMatch(
      /(?:^|\s)(?:sm|md|lg|xl|2xl):(?:flex-col|block|flex)\b/u,
    )
  })

  it('has no container variant in a forced strip or a forced list', () => {
    for (const presentation of ['strip', 'list'] as const) {
      const everything = SLOTS.map((slot) =>
        sectionNavClasses(frame, slot, presentation),
      ).join(' ')

      expect(everything).not.toContain('@')
    }
  })
})

describe('the two frames', () => {
  it('switch at different container widths', () => {
    expect(SECTION_NAV_LIST_FROM.rail).not.toBe(SECTION_NAV_LIST_FROM.inline)
  })
})

describe.each(FRAMES)('the %s layout', (frame) => {
  it('changes at the width its nav becomes a list', () => {
    expect(SECTION_NAV_LAYOUT[frame].inner).toContain(SECTION_NAV_LIST_FROM[frame])
  })
})
