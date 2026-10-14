// The live line of a Goals row against Storybook, where Tailwind is compiled. The
// Vitest story runner compiles none, so "the placeholder a row shows while its
// month is read is exactly as high as the line that replaces it" cannot be read
// back there (`src/components/goals/goal-live-line.stories.tsx` covers what it
// can). A placeholder a pixel short pushes every row below it down when the
// figure arrives, which is the layout shift it exists to prevent. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// A Goals row on a phone is narrow: at a 375 px screen its cell is about 230 px
// (page gutter, frame, row padding and the status column come off). The count
// line with its "below pace" note needs about 270 px, 306 px with a thousands
// figure, so there the note cannot follow the days left without wrapping to a
// second line, and a line that wraps only when the figure says "below pace"
// would be one line taller than its placeholder (measured 2026-10-14: 40 px
// against 20 px in a 230 px cell). So the note sits beside the bar when the cell
// is narrow, and the bar's line is kept as high as the note in either case.
// Every case below is therefore measured twice: at the viewport widths a page
// has, and in cells pinned from the narrowest a phone row gets to a desktop's.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

/**
 * The stories, and the narrowest cell each is held to. The figure sentence alone
 * ("12,345 of 15,000 so far · 14 days left", 245 px) wraps in a narrower cell
 * than its note ever does, and always did: that wrap is the sentence's, not the
 * note's, and a placeholder cannot know the digits it will be given. So a story
 * is measured down to the narrowest cell its own sentence fits (measured
 * 2026-10-14: 190 px for "64 of 120", 245 px for five digits on each side).
 */
const STORIES = {
  count: { id: 'goals-goalliveline--pending-keeps-the-room-of-a-count', from: 200 },
  countBelowPace: {
    id: 'goals-goalliveline--pending-keeps-the-room-of-a-count-below-pace',
    from: 200,
  },
  countBelowPaceFiveDigits: {
    id: 'goals-goalliveline--pending-keeps-the-room-of-a-count-of-five-digits-below-pace',
    from: 250,
  },
  line: { id: 'goals-goalliveline--pending-keeps-the-room-of-a-line', from: 200 },
} as const

const VIEWPORTS = [
  { name: 'a desktop', width: 1280, height: 800 },
  { name: 'a phone', width: 375, height: 800 },
] as const

/**
 * The cell widths a row's live line gets: 200 is a 320 px phone, 230 a 375 px
 * one, 343 the whole row of a phone, 383 and 384 either side of the width the
 * note moves to follow the days left at (24 rem), and 640 a tablet.
 */
const CELL_WIDTHS = [200, 230, 260, 300, 343, 383, 384, 440, 640, 1000] as const

type Room = Readonly<{ pending: number; loaded: number }>

/** The room each slot takes, margin included, as the rows below feel it. */
async function slotRoom(page: Page): Promise<Room> {
  return page.evaluate(() => {
    const room = (slot: string): number => {
      const element = document.querySelector(`[data-slot="${slot}"]`)
      if (!element) throw new Error(`No ${slot} drawn`)
      const margin = Number.parseFloat(getComputedStyle(element).marginTop)
      return element.getBoundingClientRect().height + margin
    }
    return { pending: room('goal-live-line-pending'), loaded: room('goal-live-line') }
  })
}

/** The room of both slots in a cell of this width: the story's own box, pinned. */
async function slotRoomInCell(page: Page, width: number): Promise<Room> {
  await page.evaluate((cellWidth) => {
    const pending = document.querySelector('[data-slot="goal-live-line-pending"]')
    const box = pending?.parentElement
    if (!box) throw new Error('No box around the slots')
    box.style.width = `${cellWidth}px`
  }, width)
  return slotRoom(page)
}

for (const viewport of VIEWPORTS) {
  test.describe(`on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const [name, story] of Object.entries(STORIES)) {
      test(`${name} keeps the room its line takes`, async ({ page }) => {
        await openStory(page, story.id)

        const { pending, loaded } = await slotRoom(page)

        expect(pending).toBeGreaterThan(0)
        expect(pending).toBe(loaded)
      })
    }
  })
}

test.describe('in a cell as narrow as a row on a phone', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  for (const [name, story] of Object.entries(STORIES)) {
    test(`${name} keeps the room its line takes in every cell width`, async ({
      page,
    }) => {
      await openStory(page, story.id)

      for (const width of CELL_WIDTHS.filter((cell) => cell >= story.from)) {
        const { pending, loaded } = await slotRoomInCell(page, width)

        expect(pending, `${name} in a ${width}px cell`).toBeGreaterThan(0)
        expect(loaded, `${name} in a ${width}px cell`).toBe(pending)
      }
    })
  }
})

/** The width of a cell from which the note follows the days left: `@sm`, 24 rem. */
const NOTE_FOLLOWS_FROM = 384

type NotePlace = Readonly<{
  onSentenceLine: boolean
  roomWithNote: number
  roomWithout: number
}>

/** Where the note sits against the sentence, and what the slot takes with and without it. */
async function notePlace(page: Page): Promise<NotePlace> {
  return page.evaluate(() => {
    const slot = document.querySelector('[data-slot="goal-live-line"]')
    const sentence = slot?.querySelector('p')
    const note = slot?.querySelector<HTMLElement>('[data-slot="goal-live-pace"]')
    if (!slot || !sentence || !note) throw new Error('No sentence and note drawn')
    const room = Math.round(slot.getBoundingClientRect().height)
    const onSentenceLine =
      note.getBoundingClientRect().top < sentence.getBoundingClientRect().bottom
    note.style.display = 'none'
    const roomWithout = Math.round(slot.getBoundingClientRect().height)
    note.style.display = ''
    return { onSentenceLine, roomWithNote: room, roomWithout }
  })
}

test.describe('the note of a count below pace', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('follows the days left where the cell has room and sits beside the bar where it has not', async ({
    page,
  }) => {
    await openStory(page, STORIES.countBelowPace.id)

    for (const width of CELL_WIDTHS.filter(
      (cell) => cell >= STORIES.countBelowPace.from,
    )) {
      await slotRoomInCell(page, width)
      const { onSentenceLine } = await notePlace(page)

      expect(onSentenceLine, `the note in a ${width}px cell`).toBe(
        width >= NOTE_FOLLOWS_FROM,
      )
    }
  })

  test('adds no height to the line in any cell, so a row that says it is no taller', async ({
    page,
  }) => {
    for (const story of [STORIES.countBelowPace, STORIES.countBelowPaceFiveDigits]) {
      await openStory(page, story.id)

      for (const width of CELL_WIDTHS.filter((cell) => cell >= story.from)) {
        await slotRoomInCell(page, width)
        const { roomWithNote, roomWithout } = await notePlace(page)

        expect(roomWithNote, `${story.id} in a ${width}px cell`).toBe(roomWithout)
      }
    }
  })
})
