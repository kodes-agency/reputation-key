// The header slots (UI consistency scan: FRAME-08, FRAME-09, NAV-10). Each has one job:
//
//   title        what the page is, or the name of the entity it is about
//   meta         where you are and what state it is in: the Property, a count, a status
//   description  one sentence of purpose, help text and nothing else
//   actions      what the page lets you do
//
// A page goes up through its breadcrumbs, and every crumb above the page links
// (`trailCrumbs`), the Property's included. Dark is the default theme; the light
// variant renders the same headers on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { AddActionLink } from '#/components/ui/add-action'
import { StatusBadge } from '#/components/ui/status-badge'
import { GOAL_STATUS } from '#/components/goals/goal-status'
import { PageHeader } from './page-header'
import { trailCrumbs } from './page-identity'

const meta: Meta<typeof PageHeader> = {
  title: 'Patterns/Page header',
  component: PageHeader,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof PageHeader>

const WHERE = { propertyId: 'p1', propertyName: 'Hotel Aurora' } as const

/** A list says how much it holds in meta, and its add action sits in the header. */
export const ListWithCount: Story = {
  args: {
    title: 'Properties',
    meta: ['6 properties', '1 paused'],
    actions: (
      <AddActionLink to="/properties/import-google">Import from Google</AddActionLink>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'Properties' })).toBeVisible()
    expect(canvas.getByText('6 properties')).toBeVisible()
    expect(canvas.getByText('1 paused')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Import from Google' })).toBeVisible()
  },
}

/** The Property a page is about is meta, and the trail above it links to the Property. */
export const IdentityAndTrail: Story = {
  args: {
    title: 'Overview',
    meta: [WHERE.propertyName],
    breadcrumbs: trailCrumbs('property', WHERE, 'Overview'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trail = within(canvas.getByRole('navigation', { name: 'breadcrumb' }))
    expect(trail.getByRole('link', { name: 'Properties' })).toHaveAttribute(
      'href',
      '/properties',
    )
    expect(trail.getByRole('link', { name: 'Hotel Aurora' })).toHaveAttribute(
      'href',
      '/properties/p1',
    )
    expect(trail.getByText('Overview')).toHaveAttribute('aria-current', 'page')
    expect(
      canvasElement.querySelector('[data-slot="page-header-meta"]'),
    ).toHaveTextContent('Hotel Aurora')
  },
}

/** An entity page puts its status in meta, and its description is only its own words. */
export const EntityWithStatus: Story = {
  args: {
    title: 'More replies, faster',
    meta: [<StatusBadge key="status" status="active" map={GOAL_STATUS} />],
    description: 'Reply to every review within a day.',
    breadcrumbs: trailCrumbs('goals', WHERE, 'More replies, faster'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Active')).toBeVisible()
    expect(canvas.getByText('Reply to every review within a day.')).toBeVisible()
    const meta = canvasElement.querySelector('[data-slot="page-header-meta"]')
    const description = canvas.getByText('Reply to every review within a day.')
    // Meta reads before the description.
    expect(meta?.compareDocumentPosition(description)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  },
}

/** A page with only a sentence of purpose has no meta line at all. */
export const PurposeOnly: Story = {
  args: {
    title: 'Ratings',
    description: 'How you are rated, and whether you are replying.',
    breadcrumbs: trailCrumbs('property', WHERE, 'Ratings'),
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-slot="page-header-meta"]')).toBeNull()
    expect(
      within(canvasElement).getByText('How you are rated, and whether you are replying.'),
    ).toBeVisible()
  },
}

/** The same header on the light surface. */
export const IdentityAndTrailLight: Story = {
  ...IdentityAndTrail,
  parameters: { theme: 'light' },
}
