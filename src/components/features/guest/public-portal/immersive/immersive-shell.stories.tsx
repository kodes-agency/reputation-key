// Boards G01 (arrival, with a photo) and G09 (arrival, no photo yet) of the
// round-4 guest design, built on the real shell with stand-in content. Axe runs
// on every story (`a11y.test = 'error'` in .storybook/preview.tsx). The play
// functions add what axe cannot see: that the page answers the app's global
// styles (link colour, theme class, line breaking) and does not inherit them.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { enV2 } from '../language-packs/en-v2'
import { ArrivalStandIn } from './__fixtures__/arrival-stand-in'
import { LINKTREE_LINKS_NO_PHOTO } from './__fixtures__/linktree-links'
import { STORY_HERO_PHOTO } from './__fixtures__/story-hero-photo'
import { immersiveFooterCopy } from './immersive-footer-copy'
import { ImmersiveShell } from './immersive-shell'

const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844
const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const

/** The phone of the boards: 390 x 844, so `container` height has a frame to fill. */
const PhoneFrame: Decorator = (Story, { parameters }) => (
  <div
    data-testid="phone-frame"
    style={{
      width: parameters.frameWidth ?? PHONE_WIDTH,
      height: PHONE_HEIGHT,
      margin: '0 auto',
      overflowY: 'auto',
    }}
  >
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)

const meta: Meta<typeof ImmersiveShell> = {
  title: 'Features/Guest/ImmersiveShell',
  component: ImmersiveShell,
  decorators: [PhoneFrame],
  parameters: { layout: 'fullscreen' },
  args: {
    lang: 'en',
    height: 'container',
    heroAlt: { value: 'The colonnade pool at dusk, under an old olive tree' },
    brand: { ...CHAMPAGNE, hero: STORY_HERO_PHOTO },
    children: (
      <ArrivalStandIn
        displayName="Avela Resort"
        footerCopy={immersiveFooterCopy(enV2, 'Avela Resort')}
      />
    ),
  },
}
export default meta

type Story = StoryObj<typeof ImmersiveShell>

const rootOf = (canvasElement: HTMLElement) => {
  const root = canvasElement.querySelector<HTMLElement>('.ih-root')
  if (!root) throw new Error('the shell root is missing')
  return root
}

/** Board G01. The photo is the one eager, high-priority image and keeps its size. */
export const G01Arrival: Story = {
  play: async ({ canvasElement }) => {
    const root = rootOf(canvasElement)
    expect(root.dataset.ihSurface).toBe('photo')
    const hero = canvasElement.querySelector<HTMLImageElement>('.ih-hero__image')
    expect(hero?.getAttribute('fetchpriority')).toBe('high')
    expect(hero?.getAttribute('loading')).toBe('eager')
    expect(hero?.getAttribute('width')).toBe('1600')
    expect(hero?.getAttribute('height')).toBe('1000')
    expect(hero?.alt).toBe('The colonnade pool at dusk, under an old olive tree')
    // The hero box is sized by the stylesheet, not by the file: 236 px tall.
    expect(hero?.getBoundingClientRect().height).toBe(236)
    // Only the hero is prioritised; the blurred copy is decorative.
    const prioritised = canvasElement.querySelectorAll('img[fetchpriority="high"]')
    expect(prioritised).toHaveLength(1)
    expect(canvasElement.querySelector('.ih-backdrop')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  },
}

/** Board G09. No image at all: the field, its washes, the grain and the arch. */
export const G09NoPhoto: Story = {
  args: {
    brand: { ...CHAMPAGNE, hero: null },
    heroAlt: { value: '' },
    children: (
      <ArrivalStandIn
        displayName="Avela Resort"
        footerCopy={immersiveFooterCopy(enV2, 'Avela Resort')}
        links={LINKTREE_LINKS_NO_PHOTO}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const root = rootOf(canvasElement)
    expect(root.dataset.ihSurface).toBe('field')
    expect(canvasElement.querySelectorAll('img')).toHaveLength(0)
    const arch = canvasElement.querySelector('.ih-arch')
    expect(arch?.getAttribute('aria-hidden')).toBe('true')
    expect(canvasElement.querySelector('feTurbulence')).not.toBeNull()
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible()
  },
}

/**
 * The global link colour, the theme class and the body's line breaking must not
 * reach the page. Runs in the light theme, where the app's own tokens are the
 * furthest from the page's. Page height: the public route's shell owns the
 * document's colour scheme.
 */
export const IgnoresTheAppTheme: Story = {
  args: { height: 'page' },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const root = rootOf(canvasElement)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    const rootStyle = getComputedStyle(root)
    expect(rootStyle.backgroundColor).toBe('rgb(21, 17, 13)')
    expect(rootStyle.colorScheme).toBe('dark')
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark')
    expect(rootStyle.overflowWrap).toBe('break-word')
    expect(rootStyle.hyphens).toBe('auto')
    // A tile link takes the page's text colour, not the app's accent colour.
    const tile = canvasElement.querySelector<HTMLElement>('nav a')
    expect(tile && getComputedStyle(tile).color).toBe(rootStyle.color)
    expect(tile && getComputedStyle(tile).textDecorationLine).toBe('none')
    // A link that asks for the accent gets it, underlined.
    const privacy = within(canvasElement).getByRole('link', { name: 'Privacy notice' })
    expect(getComputedStyle(privacy).textDecorationLine).toBe('underline')
    expect(getComputedStyle(privacy).color).not.toBe(rootStyle.color)
  },
}

/**
 * A shell in a frame (the admin preview) sits inside the app's own document: it
 * must leave the document's colour scheme and body colour alone, and it is no
 * second `main` landmark.
 */
export const ContainerLeavesTheDocument: Story = {
  args: { height: 'container' },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const root = rootOf(canvasElement)
    expect(root.tagName).toBe('DIV')
    expect(canvasElement.querySelector('main')).toBeNull()
    // The shell itself is dark ...
    expect(getComputedStyle(root).colorScheme).toBe('dark')
    // ... but the document around it keeps the app's light scheme and body.
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(getComputedStyle(document.documentElement).colorScheme).not.toBe('dark')
    expect(getComputedStyle(document.body).backgroundColor).not.toBe('rgb(13, 18, 16)')
  },
}

/** An accent that cannot be read on the field is replaced by the text colour. */
export const DarkAccentIsReplaced: Story = {
  args: { brand: { accentColour: '#1F2A44', fieldColour: '#10131A', hero: null } },
  play: async ({ canvasElement }) => {
    const send = within(canvasElement).getByRole('button', { name: 'Send privately' })
    expect(getComputedStyle(send).backgroundColor).toBe('rgb(246, 241, 232)')
    expect(getComputedStyle(send).color).toBe('rgb(0, 0, 0)')
  },
}

/** A wide viewport keeps the phone-width column and lets the backdrop run full width. */
export const WideViewport: Story = {
  parameters: { frameWidth: 1024 },
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector<HTMLElement>('.ih-column')
    expect(column?.getBoundingClientRect().width).toBe(480)
    expect(rootOf(canvasElement).getBoundingClientRect().width).toBe(1024)
  },
}
