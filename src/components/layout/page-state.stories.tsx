// PageState: the one page-level state for a page that is loading, failed, is
// missing, or is not available to the person. Every route fallback and the
// router's defaults draw it (see `route-page-state`), so a failure reads the same
// on every page and the page keeps its title, breadcrumbs and width while it
// loads. The plays check the rendered loading shapes, dimensions and landmarks.
import { playInThemes } from '../../../.storybook/play-in-themes'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PageState } from './page-state'
import { PAGE_GUTTER } from './page-shell'

const crumbs = [
  { label: 'Properties', to: '/properties' },
  { label: 'Hotel Elegance', to: '/properties/p1' },
  { label: 'People' },
] as const

const meta: Meta<typeof PageState> = {
  title: 'Patterns/PageState',
  component: PageState,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  // A state sits in `<main>`, which pads the page.
  render: (args) => (
    <div className={PAGE_GUTTER}>
      <PageState {...args} />
    </div>
  ),
}
export default meta
type Story = StoryObj<typeof PageState>

/** The page keeps its name: one `h1`, the breadcrumb trail, and a busy region screen readers announce. */
export const Loading: Story = {
  args: { kind: 'loading', title: 'People', breadcrumbs: crumbs, tier: 'dashboard' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Hotel Elegance' })).toHaveAttribute(
      'href',
      '/properties/p1',
    )
    const busy = canvasElement.querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    // The label is announced, not drawn.
    const label = within(busy as HTMLElement).getByText('Loading People')
    expect(label).toHaveTextContent('Loading People')
    expect(label.getBoundingClientRect().width).toBe(1)
    expect(label.getBoundingClientRect().height).toBe(1)
    // Same width as the dashboard-tier page it stands in for.
    const shell = canvasElement.querySelector('[data-loading-shape]')!.parentElement!
    expect(getComputedStyle(shell).maxWidth).toBe('1200px')
  },
}

const shapeOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector('[data-loading-shape]')?.getAttribute('data-loading-shape')

/** A dashboard page loads as a row of tiles and a chart: the shape of what replaces it. */
export const LoadingScorecard: Story = {
  args: { kind: 'loading', title: 'Ratings', tier: 'dashboard', shape: 'scorecard' },
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('scorecard')
    expect(
      canvasElement.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(5)
  },
}

/** A list loads as its toolbar and a bordered table of rows. */
export const LoadingList: Story = {
  args: { kind: 'loading', title: 'Staff', tier: 'dashboard', shape: 'list' },
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('list')
    const body = canvasElement.querySelector('[data-loading-shape="list"]')!
    const table = body.lastElementChild!
    expect(getComputedStyle(table).borderTopWidth).toBe('1px')
    expect(table.children).toHaveLength(7)
  },
}

/** A settings page loads as cards, in the narrow tier it is drawn in. */
export const LoadingCards: Story = {
  args: { kind: 'loading', title: 'Profile', tier: 'narrow', headerLines: 1 },
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('cards')
    const shell = canvasElement.querySelector('[data-loading-shape]')!.parentElement!
    expect(getComputedStyle(shell).maxWidth).toBe('768px')
  },
}

/** A form with its preview loads as two columns from `lg`; a header of two lines holds both. */
export const LoadingSplit: Story = {
  args: {
    kind: 'loading',
    title: 'Portal group',
    tier: 'dashboard',
    shape: 'split',
    headerLines: 2,
  },
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('split')
    const body = canvasElement.querySelector('[data-loading-shape="split"]')!
    const form = body.children[1]!.getBoundingClientRect()
    const preview = body.children[2]!.getBoundingClientRect()
    if (window.innerWidth >= 1024) {
      expect(preview.width).toBe(336)
      expect(preview.left).toBeGreaterThanOrEqual(form.right)
      expect(preview.top).toBe(form.top)
    } else {
      expect(preview.top).toBeGreaterThanOrEqual(form.bottom)
    }
  },
}

/** A page whose header has no line under its title holds none. */
export const LoadingNoHeaderLines: Story = {
  args: { kind: 'loading', title: 'Goal', headerLines: 0, shape: 'cards' },
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector('h1')?.parentElement
    expect(header?.querySelector('[data-slot="skeleton"]')).toBeNull()
  },
}

/**
 * The Portal workspace loads as its own surface: header band, tab strip, section
 * column, form and preview, on the breakpoints of the editor.
 */
export const LoadingWorkspace: Story = {
  args: { kind: 'loading', title: 'Portal', fullBleed: true },
  render: (args) => (
    <div className="h-[40rem] overflow-hidden border-y">
      <PageState {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('workspace')
    expect(
      within(canvasElement).getByRole('heading', { level: 1, name: 'Portal' }),
    ).toBeVisible()
    // A surface draws no page gutter or shell around itself.
    const body = canvasElement.querySelector('[data-loading-shape="workspace"]')!
    expect(body.parentElement).toBe(canvasElement.firstElementChild)
  },
}

/** The Inbox loads as its queue rail, list and detail pane, the rail from `@min-[1022px]`. */
export const LoadingInbox: Story = {
  args: { kind: 'loading', title: 'Inbox', fullBleed: true, shape: 'inbox' },
  render: (args) => (
    <div className="h-[40rem] overflow-hidden border-y">
      <PageState {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(shapeOf(canvasElement)).toBe('inbox')
    expect(
      within(canvasElement).getByRole('heading', { level: 1, name: 'Inbox' }),
    ).toBeVisible()
    const rows = [
      ...canvasElement.querySelectorAll('[data-loading-shape="inbox"] div'),
    ].filter(
      (element) =>
        element.children.length === 3 &&
        element.firstElementChild?.getAttribute('data-slot') === 'skeleton' &&
        element.lastElementChild?.getAttribute('data-slot') === 'skeleton',
    )
    expect(rows).toHaveLength(8)
    for (const row of rows) expect(row.getBoundingClientRect().height).toBe(78)
  },
}

export const LoadingLight: Story = {
  ...Loading,
  parameters: { ...Loading.parameters, theme: 'light' },
}

/** Nothing is known about the page (the shell's own load): the body alone, no header. */
export const LoadingWithoutHeader: Story = {
  args: { kind: 'loading' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('heading', { level: 1 })).toBeNull()
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

/** A custom screen-reader label, for a state that knows better than the title. */
export const LoadingCustomLabel: Story = {
  args: { kind: 'loading', title: 'Portals', label: 'Loading portals and portal groups' },
  play: async ({ canvasElement }) => {
    const label = within(canvasElement).getByText('Loading portals and portal groups')
    expect(label.getBoundingClientRect().width).toBe(1)
    expect(label.getBoundingClientRect().height).toBe(1)
  },
}

const retry = fn()

/** A failure keeps the page's frame, says so in a destructive alert, and can be retried. */
export const Failed: Story = {
  args: {
    kind: 'error',
    title: 'People',
    breadcrumbs: crumbs,
    tier: 'dashboard',
    message: 'Something went wrong loading this page.',
    onRetry: retry,
  },
  play: async ({ canvasElement }) => {
    retry.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
    expect(canvas.getByRole('alert')).toHaveTextContent(
      'Something went wrong loading this page.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  },
}

export const FailedLight: Story = {
  ...Failed,
  parameters: { ...Failed.parameters, theme: 'light' },
}

/** With nothing to retry (a refusal that cannot succeed twice) the state offers no Try again. */
export const FailedWithoutRetry: Story = {
  args: { kind: 'error', title: 'Portals', message: 'You do not have access.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
}

/** An entity that is gone: what is missing, why it may be, and a real link out. */
export const NotFound: Story = {
  args: {
    kind: 'notFound',
    title: 'Portal group',
    breadcrumbs: [
      { label: 'Properties', to: '/properties' },
      { label: 'Hotel Elegance', to: '/properties/p1' },
      { label: 'Portals', to: '/properties/p1/portals' },
      { label: 'Portal group' },
    ],
    tier: 'dashboard',
    heading: 'This group is no longer available',
    reason: 'It may have been archived, or it may belong to a different property.',
    back: { to: '/properties/p1/portals', label: 'Back to portals' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'Portal group' })).toBeVisible()
    expect(canvas.getByText('This group is no longer available')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Back to portals' })).toHaveAttribute(
      'href',
      '/properties/p1/portals',
    )
    // A second try cannot succeed, so none is offered.
    expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
}

export const NotFoundLight: Story = {
  ...NotFound,
  parameters: { ...NotFound.parameters, theme: 'light' },
}

/** A page the person's role or the beta does not open: title, reason and the way back. */
export const Unavailable: Story = {
  args: {
    kind: 'unavailable',
    title: 'Goals',
    heading: 'Goals is not part of this beta',
    reason:
      'This capability is switched off for the closed beta and cannot be enabled from Settings.',
    back: { to: '/properties', label: 'Back to properties' },
  },
  play: playInThemes(async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible()
    expect(canvas.getByText('Goals is not part of this beta')).toBeVisible()
    expect(
      canvas.getByText(/switched off for the closed beta and cannot be enabled/),
    ).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Back to properties' })).toHaveAttribute(
      'href',
      '/properties',
    )
  }),
}

/** The tiers: a state stands in for its page at the page's width. */
export const NarrowTier: Story = {
  args: { kind: 'loading', title: 'Notifications', tier: 'narrow' },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector('[data-loading-shape]')!.parentElement!
    expect(getComputedStyle(shell).maxWidth).toBe('768px')
  },
}

export const StandardTier: Story = {
  args: { kind: 'loading', title: 'Property settings' },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector('[data-loading-shape]')!.parentElement!
    expect(getComputedStyle(shell).maxWidth).toBe('1024px')
  },
}

/**
 * A full-bleed surface drops the `<main>` gutter and owns its scroll, so its
 * states wear the gutter themselves (the Portal workspace, Inbox, Reviews). A
 * loading state of one of them draws the surface itself (`LoadingWorkspace`); a
 * failure, or a page of a body shape that is not a surface, wears the frame.
 */
export const FullBleed: Story = {
  args: { kind: 'loading', title: 'Portal', fullBleed: true, shape: 'cards' },
  render: (args) => (
    <div className="h-72 overflow-hidden border-y">
      <PageState {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.firstElementChild!.firstElementChild!
    const style = getComputedStyle(frame)
    expect(style.overflowY).toBe('auto')
    expect(style.paddingLeft).toBe(window.innerWidth < 768 ? '16px' : '24px')
    expect(style.paddingTop).toBe(window.innerWidth < 768 ? '20px' : '32px')
  },
}
