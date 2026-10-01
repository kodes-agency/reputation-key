// The Linktree on the real shell, in the states of boards G01, G09 and G10.
// Axe runs on every story (`a11y.test = 'error'` in .storybook/preview.tsx).
// The play functions add what axe cannot see: where a tap goes before and after a
// rating, the language of a copied text, and that no word is clipped.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { trackedLinkHref } from '../portal-link-href'
import {
  LINKTREE_LINKS_DE,
  LINKTREE_LINKS_EN,
  LINKTREE_LINKS_LONG_WORDS,
} from './__fixtures__/linktree-links'
import { ImmersiveLinktree } from './immersive-linktree'
import { ImmersiveShell } from './immersive-shell'

const PHONE_HEIGHT = 844
const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const
const TOKEN = 'story-token'

/** A phone of the width a story asks for (390 by default, the boards' width). */
const PhoneFrame: Decorator = (Story, { parameters }) => (
  <div
    data-testid="phone-frame"
    style={{
      width: parameters.frameWidth ?? 390,
      height: PHONE_HEIGHT,
      margin: '0 auto',
      overflowY: 'auto',
    }}
  >
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)

const meta = {
  title: 'Features/Guest/ImmersiveLinktree',
  component: ImmersiveLinktree,
  // Storybook applies the first decorator innermost, so the shell comes first
  // and the phone frame wraps it. The other way round put the 390 px frame
  // inside the shell's padded column, 32 px wider than the column it sat in.
  decorators: [
    (Story, { parameters }) => (
      <ImmersiveShell
        brand={{ ...CHAMPAGNE, hero: null }}
        heroAlt={{ value: '' }}
        lang={parameters.lang ?? 'en'}
        height="container"
      >
        <Story />
      </ImmersiveShell>
    ),
    PhoneFrame,
  ],
  parameters: { layout: 'fullscreen' },
  args: {
    enabled: true,
    title: { value: 'Around the resort', fallbackFrom: null },
    defaultTitle: 'Useful links',
    links: LINKTREE_LINKS_EN,
    hrefFor: (linkId: string) => trackedLinkHref(TOKEN, linkId),
  },
} satisfies Meta<typeof ImmersiveLinktree>
export default meta

type Story = StoryObj<typeof meta>

const tiles = (canvasElement: HTMLElement) => within(canvasElement).getAllByRole('link')

/** Boards G01 and G09. Visible from arrival: a plain link to the click route, no session needed. */
export const BeforeARating: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Around the resort',
    })
    expect(nav).toBeVisible()
    const links = tiles(canvasElement)
    expect(links).toHaveLength(4)
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      LINKTREE_LINKS_EN.map((link) => `/api/public/p/${TOKEN}/click/${link.id}`),
    )
    // A photo tile and three icon tiles; every tile is at least 96 px high and 44 px wide.
    expect(canvasElement.querySelectorAll('.ih-tile--photo')).toHaveLength(1)
    expect(canvasElement.querySelectorAll('.ih-tile--icon')).toHaveLength(3)
    for (const link of links) {
      const box = link.getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(96)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  },
}

const selectLink = fn(async (_linkId: string) => ({ url: '#resolved-destination' }))
const hashHref = (linkId: string) => `#tile-${linkId}`

/** What the tile's own click handler decided, read after it has run and before the browser acts. */
type TapObservation = { clickedHref: string | null; takenOver: boolean }

/**
 * Sends a click to a tile and reports whether the page took it over
 * (`preventDefault`). The observer then cancels the browser's navigation so the
 * story stays in place. Before a rating nothing may take a tap over.
 */
function tap(tile: HTMLElement, init: MouseEventInit = {}): TapObservation {
  const seen: TapObservation = { clickedHref: tile.getAttribute('href'), takenOver: true }
  const observe = (event: Event) => {
    seen.takenOver = event.defaultPrevented
    event.preventDefault()
  }
  document.addEventListener('click', observe)
  try {
    tile.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
    )
  } finally {
    document.removeEventListener('click', observe)
  }
  return seen
}

/**
 * The core rule of the slice: before a rating a tap is a plain navigation. The
 * page holds no selector, so nothing can reach the recording action; the tile
 * leaves the click to the browser, which follows its click route.
 */
export const TapBeforeARatingIsPlainNavigation: Story = {
  play: async ({ canvasElement }) => {
    const seen = tap(within(canvasElement).getByRole('link', { name: /Spa/u }))
    expect(seen.takenOver).toBe(false)
    expect(seen.clickedHref).toBe(trackedLinkHref(TOKEN, 'link-spa'))
  },
}

/**
 * The same tiles after a rating: a tap records the qualified action first. The
 * destination the action resolves here is not an https URL, so the page falls
 * back to the click route (the tile's href) instead of going to it.
 */
export const AfterARating: Story = {
  args: { selectLink, hrefFor: hashHref },
  beforeEach: () => {
    selectLink.mockClear()
    window.location.hash = ''
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('link', { name: /Spa/u }))
    expect(selectLink).toHaveBeenCalledTimes(1)
    expect(selectLink).toHaveBeenCalledWith('link-spa')
    await waitFor(() => expect(window.location.hash).toBe('#tile-link-spa'))
  },
}

/** A modified click is the browser's own (a new tab): the page must not take it over or record it. */
export const ModifiedClickLeavesTheTapToTheBrowser: Story = {
  args: { selectLink },
  beforeEach: () => {
    selectLink.mockClear()
  },
  play: async ({ canvasElement }) => {
    const spa = within(canvasElement).getByRole('link', { name: /Spa/u })
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(tap(spa, init).takenOver).toBe(false)
    }
    expect(tap(spa, { button: 1 }).takenOver).toBe(false)
    expect(selectLink).not.toHaveBeenCalled()
  },
}

/** Board G10. One text nobody has translated yet is shown in English and says so. */
export const GermanWithFallback: Story = {
  args: {
    title: { value: 'Rund um das Resort', fallbackFrom: null },
    links: LINKTREE_LINKS_DE,
  },
  parameters: { lang: 'de' },
  play: async ({ canvasElement }) => {
    const marked = canvasElement.querySelectorAll('[lang="en"]')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain('Olive Terrace menu')
    expect(
      within(canvasElement).getByRole('navigation', { name: 'Rund um das Resort' }),
    ).toBeVisible()
  },
}

/** A narrow phone and words that cannot break: the tile grows or the word wraps, nothing is clipped. */
export const LongWordsAtThreeTwenty: Story = {
  args: { links: LINKTREE_LINKS_LONG_WORDS },
  parameters: { lang: 'de', frameWidth: 320 },
  play: async ({ canvasElement }) => {
    for (const link of tiles(canvasElement)) {
      expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth)
      for (const text of link.querySelectorAll<HTMLElement>(
        '.ih-tile__label, .ih-tile__line',
      )) {
        expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1)
      }
    }
  },
}

/** An odd number of tiles: the last one takes the whole row. */
export const ThreeLinks: Story = {
  args: { links: LINKTREE_LINKS_EN.slice(0, 3) },
  play: async ({ canvasElement }) => {
    const [first, , last] = tiles(canvasElement)
    expect(last?.getBoundingClientRect().width).toBeGreaterThan(
      (first?.getBoundingClientRect().width ?? 0) * 1.9,
    )
  },
}

export const OneLink: Story = {
  args: { links: LINKTREE_LINKS_EN.slice(1, 2) },
  play: async ({ canvasElement }) => {
    expect(tiles(canvasElement)).toHaveLength(1)
  },
}

/** A stored title that is blank falls back to the language pack's default. */
export const DefaultTitle: Story = {
  args: { title: { value: '', fallbackFrom: null } },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('navigation', { name: 'Useful links' }),
    ).toBeVisible()
  },
}

/** Switched off: nothing is drawn, not even the title. */
export const SwitchedOff: Story = {
  args: { enabled: false },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.ih-linktree')).toBeNull()
  },
}
