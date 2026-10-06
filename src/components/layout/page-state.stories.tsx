// PageState: the one page-level state for a page that is loading, failed, is
// missing, or is not available to the person. Every route fallback and the
// router's defaults draw it (see `route-page-state`), so a failure reads the same
// on every page and the page keeps its title, breadcrumbs and width while it
// loads. The Storybook Vitest project compiles no Tailwind, so the plays pin the
// classes that produce the geometry and the landmarks the states expose.
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
    expect(within(busy as HTMLElement).getByText('Loading People')).toHaveClass('sr-only')
    // Same width as the dashboard-tier page it stands in for.
    expect(canvasElement.querySelector('.max-w-\\[1200px\\]')).not.toBeNull()
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
    expect(
      within(canvasElement).getByText('Loading portals and portal groups'),
    ).toHaveClass('sr-only')
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
  play: async ({ canvasElement }) => {
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
  },
}

export const UnavailableLight: Story = {
  ...Unavailable,
  parameters: { ...Unavailable.parameters, theme: 'light' },
}

/** The tiers: a state stands in for its page at the page's width. */
export const NarrowTier: Story = {
  args: { kind: 'loading', title: 'Notifications', tier: 'narrow' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.max-w-3xl')).not.toBeNull()
  },
}

export const StandardTier: Story = {
  args: { kind: 'loading', title: 'Property settings' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.max-w-5xl')).not.toBeNull()
  },
}

/**
 * A full-bleed surface drops the `<main>` gutter and owns its scroll, so its
 * states wear the gutter themselves (the Portal workspace, Inbox, Reviews).
 */
export const FullBleed: Story = {
  args: { kind: 'loading', title: 'Portal', fullBleed: true },
  render: (args) => (
    <div className="h-72 overflow-hidden border-y">
      <PageState {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('.overflow-y-auto')
    expect(frame).not.toBeNull()
    expect(frame).toHaveClass('px-4', 'py-5', 'md:px-6', 'md:py-8')
  },
}
