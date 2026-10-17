// The review's "More actions" menu in the Inbox detail header: the way to the
// review on Google (its own Business Profile page, else the Property's public
// reviews, else nothing) and the copy items.
//
// The Vitest Storybook project compiles no Tailwind, so these plays pin roles,
// names, attributes and order, never geometry. The menu is a Radix portal, so
// its items are read from `document.body`, and they are asserted present, not
// visible: with Tailwind compiled (the Playwright metrics run) a menu row's
// opacity is still animating in when the play reads it. The 320 px phone header with the
// menu in it is `inbox-mobile-390.stories.tsx` (`OpenOnGoogleFromThePhoneSheet`).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { GOOGLE_REVIEW_LINK_COPY } from './google-review-link'
import { InboxDetailCopyMenu } from './inbox-detail-copy-menu'
import type { InboxDetailState } from './use-inbox-detail'

type Detail = NonNullable<InboxDetailState['detail']>

/** Synthetic pages (test-fixtures/google-provider-identifiers-v1.json). */
const REVIEW_PAGE =
  'https://business.google.com/n/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-reply-token-0001'
const PROPERTY_PAGE =
  'https://search.google.com/local/reviews?placeid=repkey-synthetic-place-0001'

const REVIEW_TEXT = 'Great location and very clean rooms.'
const TRIGGER_NAME = 'More actions for this review'

function detail(overrides: Partial<Detail> = {}): Detail {
  return {
    item: makeInboxItem({
      id: '00000000-0000-4000-8000-0000000000c1',
      sourceType: 'review',
    }),
    reviewText: REVIEW_TEXT,
    reviewTranslatedText: null,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    googlePropertyReviewsUrl: null,
    reviewContentStatus: 'available',
    reviewRating: 4,
    feedbackComment: null,
    feedbackRatingValue: null,
    reply: null,
    analysis: null,
    feedbackHandling: null,
    responseTarget: null,
    ...overrides,
  }
}

const meta: Meta<typeof InboxDetailCopyMenu> = {
  title: 'Inbox/Detail copy menu',
  component: InboxDetailCopyMenu,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxDetailCopyMenu>

/** Opens the menu and returns it. */
async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: TRIGGER_NAME }))
  return within(await screen.findByRole('menu'))
}

/** Closes the menu, which portals out of the story and would outlive it. */
async function closeMenu(canvasElement: HTMLElement) {
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      within(canvasElement).getByRole('button', { name: TRIGGER_NAME }),
    ).toHaveAttribute('aria-expanded', 'false'),
  )
}

/** A link item that opens Google in a new tab and tells Google nothing of RepKey. */
function expectNewTabLink(item: HTMLElement, href: string) {
  expect(item.tagName).toBe('A')
  expect(item).toHaveAttribute('href', href)
  expect(item).toHaveAttribute('target', '_blank')
  expect(item).toHaveAttribute('rel', 'noopener noreferrer')
  expect(item).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(item).toHaveAccessibleName(/opens in a new tab/i)
}

/**
 * Google gave the review's own page: `Open on Google` comes first, with the line
 * that says Google may want the account that manages the profile, then the copy
 * items under a separator.
 */
export const WithReviewPage: Story = {
  args: {
    detail: detail({
      googleReviewUrl: REVIEW_PAGE,
      googlePropertyReviewsUrl: PROPERTY_PAGE,
    }),
  },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    const items = menu.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.split('(')[0]?.trim())).toEqual([
      `${GOOGLE_REVIEW_LINK_COPY.review}${GOOGLE_REVIEW_LINK_COPY.signInHint}`,
      'Copy review text',
    ])
    const open = menu.getByRole('menuitem', { name: /^Open on Google/ })
    expectNewTabLink(open, REVIEW_PAGE)
    expect(within(open).getByText(GOOGLE_REVIEW_LINK_COPY.signInHint)).toBeInTheDocument()
    expect(menu.getByRole('separator')).toBeInTheDocument()
    expect(menu.queryByRole('menuitem', { name: /See reviews on Google/ })).toBeNull()
    await closeMenu(canvasElement)
  },
}

/** The same menu on the light surface (axe runs on both). */
export const WithReviewPageLight: Story = {
  ...WithReviewPage,
  parameters: { theme: 'light' },
}

/**
 * No page for the review: the Property's public reviews instead. It opens
 * signed out, so it carries no sign-in line.
 */
export const PropertyFallbackOnly: Story = {
  args: { detail: detail({ googlePropertyReviewsUrl: PROPERTY_PAGE }) },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    const see = menu.getByRole('menuitem', { name: /^See reviews on Google/ })
    expectNewTabLink(see, PROPERTY_PAGE)
    expect(menu.queryByText(GOOGLE_REVIEW_LINK_COPY.signInHint)).toBeNull()
    expect(menu.queryByRole('menuitem', { name: /^Open on Google/ })).toBeNull()
    expect(menu.getByRole('menuitem', { name: 'Copy review text' })).toBeInTheDocument()
    await closeMenu(canvasElement)
  },
}

/** Neither page: the copy items alone, as before, and no link. */
export const NoGooglePage: Story = {
  args: { detail: detail() },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy review text',
    ])
    expect(menu.queryAllByRole('link')).toHaveLength(0)
    expect(menu.queryByRole('separator')).toBeNull()
    await closeMenu(canvasElement)
  },
}

/**
 * A rating-only review has nothing to copy. With a page on Google the menu is
 * there for the link alone, with no separator under it.
 */
export const LinkWithoutText: Story = {
  args: { detail: detail({ reviewText: null, googleReviewUrl: REVIEW_PAGE }) },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    expect(menu.getAllByRole('menuitem')).toHaveLength(1)
    expectNewTabLink(menu.getByRole('menuitem', { name: /^Open on Google/ }), REVIEW_PAGE)
    expect(menu.queryByRole('separator')).toBeNull()
    await closeMenu(canvasElement)
  },
}

/** Nothing to copy and no page: no trigger at all, never an empty menu. */
export const NothingToOffer: Story = {
  args: { detail: detail({ reviewText: null }) },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('button', { name: TRIGGER_NAME })).toBeNull()
  },
}
