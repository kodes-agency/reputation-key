// The live line of a Goals row against Storybook, where Tailwind is compiled. The
// Vitest story runner compiles none, so "the placeholder a row shows while its
// month is read is exactly as high as the line that replaces it" cannot be read
// back there (`src/components/goals/goal-live-line.stories.tsx` covers what it
// can). A placeholder a pixel short pushes every row below it down when the
// figure arrives, which is the layout shift it exists to prevent. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// A count's row may wear a pace pill ("On pace", "Below pace") or none (a month
// the rule does not judge), and which is known only with the figure. The pill is
// 22 px high (97 px wide for "Below pace"), and a Goals row on a phone is narrow:
// the page's gutters leave a cell of 288 px on a 320 px screen. The sentence with
// five-digit figures is 242 px, so with the pill and the gap the line needs
// 347 px, and a pill that followed the days left could wrap to a second line, and
// a line that wraps only when the figure has a pill would be one line taller than
// its placeholder. So the pill sits beside the bar when the cell is narrower than
// 24 rem, in a bar row that is as high as the pill, and on the sentence's own
// row, kept as high as the pill, when it is not. Every case below is therefore
// measured twice: at the viewport widths a page has (1100, 390 and 320 px), with
// a pill and with none, and in cells pinned from the narrowest a phone row gets
// to a desktop's.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

/**
 * The stories, and the narrowest cell each is held to. The figure sentence alone
 * ("12,345 of 15,000 so far · 15 days left", 245 px) wraps in a narrower cell
 * than its pill ever does, and always did: that wrap is the sentence's, not the
 * pill's, and a placeholder cannot know the digits it will be given. So a story
 * is measured down to the narrowest cell its own sentence fits (measured
 * 2026-10-14: 190 px for "64 of 120", 245 px for five digits on each side).
 */
const STORIES = {
  count: { id: 'goals-goalliveline--pending-keeps-the-room-of-a-count', from: 200 },
  countOnPace: {
    id: 'goals-goalliveline--pending-keeps-the-room-of-a-count-on-pace',
    from: 200,
  },
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
  { name: 'a desktop', width: 1100, height: 800 },
  { name: 'a phone', width: 390, height: 800 },
  { name: 'a small phone', width: 320, height: 800 },
] as const

/**
 * The cell widths a row's live line gets: 200 and 230 are the narrowest cells it
 * was designed for (a phone's row with a column beside it), 288 and 358 are a
 * 320 and a 390 px phone's whole row (the page's gutters come off the screen), 383
 * and 384 either side of the width the pill moves to follow the days left at
 * (24 rem), and 640 a tablet.
 */
const CELL_WIDTHS = [200, 230, 260, 288, 300, 343, 358, 383, 384, 440, 640, 1000] as const

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

/** The width of a cell from which the pill follows the days left: `@sm`, 24 rem. */
const PILL_FOLLOWS_FROM = 384

/** The stories whose line wears a pill, and the narrowest cell each is held to. */
const PILL_STORIES = [
  STORIES.countOnPace,
  STORIES.countBelowPace,
  STORIES.countBelowPaceFiveDigits,
] as const

type PillPlace = Readonly<{
  onSentenceLine: boolean
  centredOnSentence: boolean
  insideSlot: boolean
  roomWithPill: number
  roomWithout: number
}>

/** Where the pill sits against the sentence, and what the slot takes with and without it. */
async function pillPlace(page: Page): Promise<PillPlace> {
  return page.evaluate(() => {
    const slot = document.querySelector('[data-slot="goal-live-line"]')
    const sentence = slot?.querySelector('p')
    const holder = slot?.querySelector<HTMLElement>('[data-slot="goal-live-pace"]')
    const pill = holder?.querySelector<HTMLElement>('[data-slot="badge"]')
    if (!slot || !sentence || !holder || !pill)
      throw new Error('No sentence and pill drawn')
    const room = Math.round(slot.getBoundingClientRect().height)
    const slotBox = slot.getBoundingClientRect()
    const pillBox = pill.getBoundingClientRect()
    const sentenceBox = sentence.getBoundingClientRect()
    const onSentenceLine = pillBox.top < sentenceBox.bottom
    const centredOnSentence =
      Math.abs(
        pillBox.top + pillBox.height / 2 - (sentenceBox.top + sentenceBox.height / 2),
      ) < 1
    // Within half a pixel: a sub-pixel rounding is not a pill hanging out of its row.
    const insideSlot =
      pillBox.top >= slotBox.top - 0.5 && pillBox.bottom <= slotBox.bottom + 0.5
    holder.style.display = 'none'
    const roomWithout = Math.round(slot.getBoundingClientRect().height)
    holder.style.display = ''
    return {
      onSentenceLine,
      centredOnSentence,
      insideSlot,
      roomWithPill: room,
      roomWithout,
    }
  })
}

test.describe('the pace pill of a count', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('follows the days left where the cell has room and sits beside the bar where it has not', async ({
    page,
  }) => {
    for (const story of PILL_STORIES) {
      await openStory(page, story.id)

      for (const width of CELL_WIDTHS.filter((cell) => cell >= story.from)) {
        await slotRoomInCell(page, width)
        const { onSentenceLine, centredOnSentence } = await pillPlace(page)

        expect(onSentenceLine, `${story.id}: the pill in a ${width}px cell`).toBe(
          width >= PILL_FOLLOWS_FROM,
        )
        if (width >= PILL_FOLLOWS_FROM) {
          expect(centredOnSentence, `${story.id}: centred in a ${width}px cell`).toBe(
            true,
          )
        }
      }
    }
  })

  test('stays inside the row it sits in, so it never hangs out of the line', async ({
    page,
  }) => {
    for (const story of PILL_STORIES) {
      await openStory(page, story.id)

      for (const width of CELL_WIDTHS.filter((cell) => cell >= story.from)) {
        await slotRoomInCell(page, width)
        const { insideSlot } = await pillPlace(page)

        expect(insideSlot, `${story.id}: the pill in a ${width}px cell`).toBe(true)
      }
    }
  })

  test('adds no height to the line in any cell, so a row that has one is no taller', async ({
    page,
  }) => {
    for (const story of PILL_STORIES) {
      await openStory(page, story.id)

      for (const width of CELL_WIDTHS.filter((cell) => cell >= story.from)) {
        await slotRoomInCell(page, width)
        const { roomWithPill, roomWithout } = await pillPlace(page)

        expect(roomWithPill, `${story.id} in a ${width}px cell`).toBe(roomWithout)
      }
    }
  })
})
