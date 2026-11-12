// Boards G01 (arrival, with a photo) and G09 (arrival, no photo yet) of the
// round-4 guest design, built on the real shell with stand-in content. Axe runs
// on every story (`a11y.test = 'error'` in .storybook/preview.tsx). The play
// functions add what axe cannot see: that the page answers the app's global
// styles (link colour, theme class, line breaking) and does not inherit them.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { enCopy } from '../language-packs/en'
import { ArrivalStandIn } from './__fixtures__/arrival-stand-in'
import { LINKTREE_LINKS_NO_PHOTO } from './__fixtures__/linktree-links'
import { PhoneFrame } from './__fixtures__/phone-frame'
import { STORY_HERO_PHOTO } from './__fixtures__/story-hero-photo'
import { immersiveFooterCopy } from './immersive-footer-copy'
import {
  HERO_PHONE_HEIGHT,
  HERO_TEXT_BANDS,
  HERO_TITLE_SCRIM,
  HERO_TITLE_SCRIM_HALF_WIDTH,
  HERO_TOP_SCRIM,
  photoMaskGradient,
  scrimGradient,
  scrimReach,
  titleScrimMaskGradient,
} from './immersive-hero-scrim'
import { IMMERSIVE_TEXT_COLOUR, PHOTO_BACKDROP } from './immersive-look'
import { ImmersiveShell } from './immersive-shell'

const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const

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
    children: <ArrivalStandIn footerCopy={immersiveFooterCopy(enCopy, 'Avela Resort')} />,
  },
}
export default meta

type Story = StoryObj<typeof ImmersiveShell>

const rootOf = (canvasElement: HTMLElement) => {
  const root = canvasElement.querySelector<HTMLElement>('.ih-root')
  if (!root) throw new Error('the shell root is missing')
  return root
}

/**
 * What the browser computes for a mask gradient. The photo's fade is in px from
 * the hero's bottom edge: one in percentages computes differently, and moves
 * with the hero.
 */
const computedMask = (root: HTMLElement, gradient: string) => {
  const probe = document.createElement('span')
  probe.style.maskImage = gradient
  root.appendChild(probe)
  const computed = getComputedStyle(probe).maskImage
  probe.remove()
  return computed
}

/** What the browser computes for a background gradient, as `computedMask` does for a mask. */
const computedBackground = (root: HTMLElement, gradient: string) => {
  const probe = document.createElement('span')
  probe.style.backgroundImage = gradient
  root.appendChild(probe)
  const computed = getComputedStyle(probe).backgroundImage
  probe.remove()
  return computed
}

const queryIn = <T extends HTMLElement>(canvasElement: HTMLElement, selector: string) =>
  canvasElement.querySelector<T>(selector)

const expectPhotoLoadedOnce = (canvasElement: HTMLElement, root: HTMLElement) => {
  expect(root.dataset.ihSurface).toBe('photo')
  const hero = queryIn<HTMLImageElement>(canvasElement, '.ih-hero__image')
  expect(hero?.getAttribute('fetchpriority')).toBe('high')
  expect(hero?.getAttribute('loading')).toBe('eager')
  expect(hero?.getAttribute('width')).toBe('1600')
  expect(hero?.getAttribute('height')).toBe('1000')
  expect(hero?.alt).toBe('The colonnade pool at dusk, under an old olive tree')
  // The hero box is sized by the stylesheet, not by the file: 236 px tall.
  expect(getComputedStyle(root).getPropertyValue('--ih-hero-h').trim()).toBe(
    `${HERO_PHONE_HEIGHT}px`,
  )
  expect(hero?.getBoundingClientRect().height).toBe(236)
  // Only the hero is prioritised; the blurred copy is decorative.
  expect(canvasElement.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(1)
  expect(queryIn(canvasElement, '.ih-backdrop')?.getAttribute('aria-hidden')).toBe('true')
}

const expectScrimsFromStops = (canvasElement: HTMLElement, root: HTMLElement) => {
  // The header's scrim hangs from the hero's top edge, the title's from its bottom edge.
  const heroBox = queryIn(canvasElement, '.ih-hero')?.getBoundingClientRect()
  const topFade = queryIn(canvasElement, '.ih-hero__scrim--top')
  const titleShade = queryIn(canvasElement, '.ih-hero__scrim--title')
  const topScrim = topFade?.getBoundingClientRect()
  const titleScrim = titleShade?.getBoundingClientRect()
  expect(topScrim?.top).toBe(heroBox?.top)
  expect(topScrim?.height).toBe(scrimReach(HERO_TOP_SCRIM))
  expect(titleScrim?.bottom).toBe(heroBox?.bottom)
  expect(titleScrim?.height).toBe(scrimReach(HERO_TITLE_SCRIM))
  // Both scrims are drawn from the stops the contrast checks assume.
  expect(topFade && getComputedStyle(topFade).backgroundImage).toBe(
    computedBackground(root, scrimGradient(HERO_TOP_SCRIM, true)),
  )
  expect(titleShade && getComputedStyle(titleShade).backgroundImage).toBe(
    computedBackground(root, scrimGradient(HERO_TITLE_SCRIM, false)),
  )
  // The title block sits where the bands say: the kicker's distance above the hero's bottom edge.
  expect(Math.round(heroMetrics(canvasElement).kickerFromBottom)).toBe(
    HERO_TEXT_BANDS.kicker.to,
  )
}

const expectBackdropShare = (canvasElement: HTMLElement, root: HTMLElement) => {
  // The blurred copy behind the page is darkened by the brightness the contrast checks assume.
  const copy = queryIn(canvasElement, '.ih-backdrop__photo')
  expect(copy && getComputedStyle(copy).filter).toContain(
    `brightness(${PHOTO_BACKDROP.brightness})`,
  )
  // The field layer over it is the share the contrast checks assume.
  const wash = queryIn(canvasElement, '.ih-backdrop__wash--photo')
  const layer = document.createElement('span')
  layer.style.backgroundColor = `color-mix(in srgb, var(--ih-field) ${PHOTO_BACKDROP.fieldMix * 100}%, transparent)`
  root.appendChild(layer)
  expect(wash && getComputedStyle(wash).backgroundColor).toBe(
    getComputedStyle(layer).backgroundColor,
  )
  layer.remove()
}

const expectFadesCoverTitle = (canvasElement: HTMLElement, root: HTMLElement) => {
  // The photo fades into the field, and the title's scrim is solid across the whole of the title column.
  const hero = queryIn(canvasElement, '.ih-hero__image')
  const fade = hero && getComputedStyle(hero).maskImage
  expect(fade).toBe(computedMask(root, photoMaskGradient()))
  expect(fade).not.toContain('%')
  const column = queryIn(canvasElement, '.ih-title')?.getBoundingClientRect()
  expect((column?.width ?? Infinity) / 2).toBeLessThanOrEqual(
    HERO_TITLE_SCRIM_HALF_WIDTH.solid,
  )
  const titleFade = queryIn(canvasElement, '.ih-hero__scrim--title')
  expect(titleFade && getComputedStyle(titleFade).maskImage).toBe(
    computedMask(root, titleScrimMaskGradient()),
  )
  const titleScrim = titleFade?.getBoundingClientRect()
  expect(titleScrim?.left).toBeLessThanOrEqual(column?.left ?? 0)
  expect(titleScrim?.right).toBeGreaterThanOrEqual(column?.right ?? Infinity)
}

/** Board G01. The photo is the one eager, high-priority image and keeps its size. */
export const G01Arrival: Story = {
  play: async ({ canvasElement }) => {
    const root = rootOf(canvasElement)
    expectPhotoLoadedOnce(canvasElement, root)
    expectScrimsFromStops(canvasElement, root)
    expectBackdropShare(canvasElement, root)
    expectFadesCoverTitle(canvasElement, root)
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
        footerCopy={immersiveFooterCopy(enCopy, 'Avela Resort')}
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
    // With no photo the kicker is drawn in the accent.
    const kicker = canvasElement.querySelector<HTMLElement>('.ih-title__kicker')
    const probe = document.createElement('span')
    probe.style.color = 'var(--ih-accent-text)'
    root.appendChild(probe)
    expect(kicker && getComputedStyle(kicker).color).toBe(getComputedStyle(probe).color)
    probe.remove()
    expect(canvasElement.querySelector('feTurbulence')).not.toBeNull()
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible()
  },
}

/**
 * A shell in a frame sits inside the app's own document: it must not force the
 * document's colour scheme or background, and no document-level rule may match
 * it. Only the page-height shell owns the document.
 */
export const FrameLeavesTheDocumentAlone: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.ih-root--page')).toBeNull()
    expect(getComputedStyle(document.documentElement).colorScheme).not.toBe('dark')
    expect(getComputedStyle(document.body).backgroundColor).not.toBe('rgb(13, 18, 16)')
    // Every document-level rule of the shell's stylesheet is scoped to the page shell.
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n')
    const documentRules = [...css.matchAll(/(?:^|\n)((?::root|html|body)[^{]*)\{/gu)]
      .map((rule) => rule[1] ?? '')
      .filter((selector) => selector.includes('.ih-root'))
    expect(documentRules.length).toBeGreaterThan(0)
    for (const selector of documentRules) expect(selector).toContain('.ih-root--page')
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
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(13, 18, 16)')
    expect(rootStyle.overflowWrap).toBe('break-word')
    expect(rootStyle.hyphens).toBe('auto')
    // The text colour is the look's own, and selected text takes the page accent, not the app's purple.
    const probe = document.createElement('span')
    probe.style.color = IMMERSIVE_TEXT_COLOUR
    root.appendChild(probe)
    expect(rootStyle.color).toBe(getComputedStyle(probe).color)
    const accent = document.createElement('span')
    accent.style.backgroundColor = 'color-mix(in srgb, var(--ih-accent) 45%, transparent)'
    root.appendChild(accent)
    expect(getComputedStyle(probe, '::selection').backgroundColor).toBe(
      getComputedStyle(accent).backgroundColor,
    )
    probe.remove()
    accent.remove()
    // A tile link takes the page's text colour, not the app's accent colour.
    const tile = canvasElement.querySelector<HTMLElement>('nav a')
    expect(tile && getComputedStyle(tile).color).toBe(rootStyle.color)
    expect(tile && getComputedStyle(tile).textDecorationLine).toBe('none')
    // A link that asks for the accent gets it, underlined.
    const privacy = within(canvasElement).getByRole('link', { name: /^Privacy notice/u })
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
    const send = within(canvasElement).getByRole('button', { name: 'Send' })
    expect(getComputedStyle(send).backgroundColor).toBe('rgb(246, 241, 232)')
    expect(getComputedStyle(send).color).toBe('rgb(0, 0, 0)')
  },
}

/**
 * A wide viewport keeps the phone-width column and lets the backdrop run full
 * width. In a frame (the admin preview) the hero stays the phone's 236 px,
 * however wide the window: only the page asks the viewport.
 */
export const WideViewport: Story = {
  parameters: { frameWidth: 1024 },
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector<HTMLElement>('.ih-column')
    expect(column?.getBoundingClientRect().width).toBe(480)
    expect(rootOf(canvasElement).getBoundingClientRect().width).toBe(1024)
    const hero = canvasElement.querySelector<HTMLElement>('.ih-hero')
    expect(hero?.getBoundingClientRect().height).toBe(236)
    // On the widest column the title's scrim is still solid behind every word of it.
    const title = canvasElement.querySelector('.ih-title')?.getBoundingClientRect()
    expect((title?.width ?? Infinity) / 2).toBeLessThanOrEqual(
      HERO_TITLE_SCRIM_HALF_WIDTH.solid,
    )
  },
}

/** The hero's height and where the kicker sits, both measured on the page. */
function heroMetrics(canvasElement: HTMLElement) {
  const hero = canvasElement.querySelector<HTMLElement>('.ih-hero')
  const kicker = canvasElement.querySelector<HTMLElement>('.ih-title__kicker')
  if (!hero || !kicker) throw new Error('the hero or the kicker is missing')
  const heroBox = hero.getBoundingClientRect()
  return {
    height: heroBox.height,
    kickerFromBottom: heroBox.bottom - kicker.getBoundingClientRect().top,
  }
}

/** The hero's measures, with its height checked against what the stylesheet gives at this width. */
function heroAtItsWidth(canvasElement: HTMLElement) {
  const metrics = heroMetrics(canvasElement)
  expect(Math.abs(metrics.height - heroHeightAt(window.innerWidth))).toBeLessThan(1)
  return metrics
}

/**
 * The hero's height the stylesheet gives the page at this window width: the
 * phone's 236 px below sm, and from sm up 34% of the width, never under 300 px
 * and never over 440 px.
 */
const heroHeightAt = (windowWidth: number) =>
  windowWidth < 640 ? 236 : Math.min(440, Math.max(300, windowWidth * 0.34))

/**
 * From sm up the hero photo grows with the viewport instead of being cropped to
 * a thin strip, and the title block follows it down so the kicker keeps the
 * same distance above the photo's bottom edge. A tablet gets the least it grows.
 * The expectation follows the window the story is opened in: the story runner
 * opens it at the tablet's width, and the geometry gate opens every story at a
 * phone's first, where the hero is the phone's.
 */
export const HeroGrowsOnATablet: Story = {
  args: { height: 'page' },
  parameters: { frameWidth: 820, viewport: { defaultViewport: 'tablet' } },
  play: async ({ canvasElement }) => {
    const { kickerFromBottom } = heroAtItsWidth(canvasElement)
    expect(Math.round(kickerFromBottom)).toBe(94)
    // The photo's fade is the same distance from the bottom on the taller hero.
    const hero = canvasElement.querySelector<HTMLElement>('.ih-hero__image')
    expect(hero && getComputedStyle(hero).maskImage).toBe(
      computedMask(rootOf(canvasElement), photoMaskGradient()),
    )
  },
}

/** On a laptop the growth stops at 440 px: bounded, not a full-width poster. */
export const HeroIsBoundedOnADesktop: Story = {
  args: { height: 'page' },
  parameters: { frameWidth: 1440, viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const { height, kickerFromBottom } = heroAtItsWidth(canvasElement)
    expect(height).toBeLessThanOrEqual(440)
    expect(Math.round(kickerFromBottom)).toBe(94)
  },
}

/** The no-photo page keeps its arch and its title where the board has them, on any width. */
export const NoPhotoPageDoesNotGrow: Story = {
  args: {
    height: 'page',
    brand: { ...CHAMPAGNE, hero: null },
    heroAlt: { value: '' },
  },
  parameters: { frameWidth: 1440, viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector<HTMLElement>('.ih-title')
    expect(title && parseFloat(getComputedStyle(title).marginTop)).toBe(78)
    expect(canvasElement.querySelector('.ih-hero')).toBeNull()
  },
}
