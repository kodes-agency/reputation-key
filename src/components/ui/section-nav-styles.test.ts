// The class lists of a SectionNav are written out whole (Tailwind finds a class
// only that way). These checks hold the container-width rules.
import { describe, expect, it } from 'vitest'
import {
  SECTION_NAV_LAYOUT,
  SECTION_NAV_STYLES,
  sectionNavClasses,
  type SectionNavFrame,
  type SectionNavSlot,
} from './section-nav-styles'

const LIST_FROM: Readonly<Record<SectionNavFrame, string>> = {
  rail: '@7xl:',
  inline: '@3xl:',
}
const FRAMES = Object.keys(SECTION_NAV_STYLES) as ReadonlyArray<SectionNavFrame>
const SLOTS = Object.keys(SECTION_NAV_STYLES.rail) as ReadonlyArray<SectionNavSlot>

describe.each(FRAMES)('the %s frame', (frame) => {
  it('waits for a container, never the viewport, to become a list', () => {
    const everything = SLOTS.map((slot) => sectionNavClasses(frame, slot)).join(' ')

    expect(everything).toContain(LIST_FROM[frame])
    expect(everything).not.toMatch(
      /(?:^|\s)(?:sm|md|lg|xl|2xl):(?:flex-col|block|flex)\b/u,
    )
  })

  it('uses only its own container width', () => {
    const other = LIST_FROM[frame === 'rail' ? 'inline' : 'rail']
    const everything = SLOTS.map((slot) => sectionNavClasses(frame, slot)).join(' ')

    expect(everything).not.toContain(other)
  })
})

describe('the two frames', () => {
  it('switch at different container widths', () => {
    expect(LIST_FROM.rail).not.toBe(LIST_FROM.inline)
  })

  it('keeps a padded-page list below the top bar and a full-bleed rail in its own pane', () => {
    expect(SECTION_NAV_STYLES.inline.nav).toContain('@3xl:top-(--app-top-bar-height)')
    expect(SECTION_NAV_STYLES.rail.scroller).toContain('@7xl:top-0')
  })
})

describe.each(FRAMES)('the %s layout', (frame) => {
  it('changes at the width its nav becomes a list', () => {
    expect(SECTION_NAV_LAYOUT[frame].inner).toContain(LIST_FROM[frame])
  })
})
