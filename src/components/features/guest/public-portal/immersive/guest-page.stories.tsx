// Whole Immersive Hub pages at page height, for the guest quality gate (round 4,
// slice 18). The gate loads each of these at 320, 375 and 768 px
// (`e2e/storybook-metrics/guest-immersive.metrics.ts`) and measures LCP and CLS
// on them in a production Storybook build (`guest-vitals.metrics.ts`). Axe runs
// on every story (`a11y.test = 'error'` in .storybook/preview.tsx).
//
// The public route does not render the v3 page until slice 19, so these are the
// real header, rating card, Linktree and footer composed the way the route will.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { expect, waitFor, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { deV2 } from '../language-packs/de-v2'
import { enV2 } from '../language-packs/en-v2'
import { GuestPageComposition } from './__fixtures__/guest-page-composition'
import { LINKTREE_LINKS_DE, LINKTREE_LINKS_NO_PHOTO } from './__fixtures__/linktree-links'

/** In the app the root links the guest fonts for this route; a story has no root. */
const GuestFonts: Decorator = (Story) => (
  <>
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </>
)

const meta: Meta<typeof GuestPageComposition> = {
  title: 'Features/Guest/ImmersivePage',
  component: GuestPageComposition,
  decorators: [GuestFonts],
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof GuestPageComposition>

/** The photo look: one eager, high-priority hero, then the page. */
export const WithPhoto: Story = {
  args: { withPhoto: true },
  play: async ({ canvasElement }) => {
    // Waits for the page: the quality gate also plays this story in a
    // production build, where the render is not flushed when the play starts.
    const hero = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLImageElement>('.ih-hero__image')
      if (found === null) throw new Error('the hero has not rendered')
      return found
    })
    expect(hero.getAttribute('fetchpriority')).toBe('high')
    expect(canvasElement.querySelector('main.ih-root')).not.toBeNull()
  },
}

/** The production default until uploads are allowed (G09): no image at all. */
export const WithoutPhoto: Story = {
  args: { withPhoto: false, links: LINKTREE_LINKS_NO_PHOTO },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { level: 1 }),
    ).toBeVisible()
    expect(canvasElement.querySelectorAll('img')).toHaveLength(0)
  },
}

/** A guest who has not acknowledged the notice: the footer first paints as one row. */
export const FirstVisitNoticeAppearsAfterPaint: Story = {
  args: {
    withPhoto: false,
    links: LINKTREE_LINKS_NO_PHOTO,
    footerStart: 'swaps-after-paint',
  },
  play: async ({ canvasElement }) => {
    const notice = await waitFor(() =>
      within(canvasElement).getByRole('region', { name: enV2.copy.visitNoticeLabel }),
    )
    expect(notice).toBeVisible()
  },
}

/** Long German compounds in the title, the rating card words, the tiles and the footer. */
export const GermanLongWords: Story = {
  args: {
    withPhoto: true,
    chrome: {
      locale: 'de',
      displayName: 'Donaudampfschifffahrtsgesellschaft Kapitän',
      title: 'Poolterrassenöffnungszeiten',
    },
    // The German pack, with its words swapped for the longest compounds a
    // property could plausibly choose, to prove the layout holds for them.
    pack: {
      ...deV2,
      copy: {
        ...deV2.copy,
        ratingTitle: 'Wie zufrieden waren Sie mit Ihrem Erlebnis?',
        ratingWord3: 'Zufriedenstellend',
        ratingWord4: 'Außergewöhnlich',
        ratingWord5: 'Ausgezeichnet',
        ratingScaleLow: 'Verbesserungsbedürftig',
        ratingScaleHigh: 'Hervorragend',
        ratingSend: 'Vertraulich weiterleiten',
      },
    },
    footerStart: 'notice',
    footerCopy: {
      privacyLink: 'Datenschutzerklärung',
      madeWith: deV2.copy.footerMadeWith,
      acknowledge: deV2.copy.visitNoticeAcknowledge,
    },
    links: LINKTREE_LINKS_DE,
    linktreeTitle: 'Wellnessbereichsöffnungszeiten',
  },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByText(/Donaudampf/u)).toBeVisible()
  },
}
