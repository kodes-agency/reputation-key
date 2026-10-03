// How a page switches between its sibling views (UI consistency scan: NAV-04,
// COLL-01, COLL-11). One underline look, two elements: `LinkTabs` when each view
// is a route (a navigation landmark of links with `aria-current`) and
// `Tabs variant="line"` when the views swap a panel in the same document. The grey
// pill stays for a mode inside a component. Dark is the default theme; the light
// variants draw the same rows on the light surface (axe runs on both).
//
// The anchors here are plain `<a href="#…">` that a click handler intercepts: the
// story router has no route tree to navigate in, and the primitive imports no
// router, so a real app passes a router `Link` as the child instead.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { LinkTab, LinkTabs } from './link-tabs'
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

const meta: Meta = {
  title: 'Patterns/View tabs',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

type View = 'workspace' | 'removed'

function PageViews({ initial }: Readonly<{ initial: View }>) {
  const [view, setView] = useState<View>(initial)
  const go = (next: View) => (event: React.MouseEvent) => {
    event.preventDefault()
    setView(next)
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <LinkTabs aria-label="Which properties">
        <LinkTab active={view === 'workspace'}>
          <a href="#workspace" onClick={go('workspace')}>
            Workspace
            <TabCount>6</TabCount>
          </a>
        </LinkTab>
        <LinkTab active={view === 'removed'}>
          <a href="#removed" onClick={go('removed')}>
            Removed
            <TabCount>1</TabCount>
          </a>
        </LinkTab>
      </LinkTabs>
      <p className="text-sm text-muted-foreground">
        {view === 'workspace'
          ? 'The working list.'
          : 'Properties waiting to be restored.'}
      </p>
    </div>
  )
}

/** Views that are a route: a named landmark of links, the current one marked. */
export const RouteViews: Story = {
  render: () => <PageViews initial="workspace" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Which properties' })
    // Not a tablist: nothing here swaps a panel in the same document.
    expect(canvas.queryByRole('tablist')).toBeNull()
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    const workspace = within(nav).getByRole('link', { name: /Workspace\s*6/ })
    expect(workspace).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Removed\s*1/ })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** Choosing a view moves `aria-current` with it, and the count stays in the name. */
export const ChoosingAView: Story = {
  render: () => <PageViews initial="workspace" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('link', { name: /Removed\s*1/ }))
    expect(canvas.getByRole('link', { name: /Removed\s*1/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(canvas.getByRole('link', { name: /Workspace\s*6/ })).not.toHaveAttribute(
      'aria-current',
    )
    expect(canvas.getByText('Properties waiting to be restored.')).toBeVisible()
  },
}

/** Every link is one Tab stop, in order, with the same focus ring as the rest. */
export const KeyboardOrder: Story = {
  render: () => <PageViews initial="workspace" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: /Workspace\s*6/ })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: /Removed\s*1/ })).toHaveFocus()
  },
}

/**
 * A narrow phone keeps the strip to one row that scrolls sideways (the list is
 * `overflow-x-auto` over a `min-w-max` row) and each link is a tap target
 * (`min-h-(--control-touch)`). The Storybook Vitest project compiles no
 * Tailwind, so this play proves the structure; the pixels are checked in the
 * browser.
 */
export const PhoneStrip: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  render: () => (
    <LinkTabs aria-label="Portal sections">
      {['Page', 'Share', 'Results', 'History'].map((label) => (
        <LinkTab key={label} active={label === 'Share'}>
          <a href={`#${label}`}>{label}</a>
        </LinkTab>
      ))}
    </LinkTabs>
  ),
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Portal sections',
    })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Page',
      'Share',
      'Results',
      'History',
    ])
    expect(within(nav).getByRole('link', { name: 'Share' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(nav.className).toContain('overflow-x-auto')
    expect(nav.querySelector('ul')?.className).toContain('min-w-max')
  },
}

/** Views that swap a panel in the same document keep the tablist, in the same look. */
export const PanelViews: Story = {
  render: () => (
    <Tabs defaultValue="all" className="max-w-md gap-0">
      <TabsList variant="line" aria-label="Filter notifications">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="unread">Unread</TabsTrigger>
        <TabsTrigger value="mentions">Mentions</TabsTrigger>
      </TabsList>
      <TabsContent value="all" className="pt-3 text-sm text-muted-foreground">
        Every notice.
      </TabsContent>
      <TabsContent value="unread" className="pt-3 text-sm text-muted-foreground">
        Notices you have not opened.
      </TabsContent>
      <TabsContent value="mentions" className="pt-3 text-sm text-muted-foreground">
        Notices that name you.
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('tablist', { name: 'Filter notifications' })).toBeVisible()
    expect(canvas.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(canvas.getByRole('tab', { name: 'Unread' }))
    expect(canvas.getByRole('tab', { name: 'Unread' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(canvas.getByText('Notices you have not opened.')).toBeVisible()
  },
}

/** The grey pill is for a mode inside a component, not for a page's views. */
export const ComponentMode: Story = {
  render: () => (
    <Tabs defaultValue="reply" className="max-w-sm">
      <TabsList aria-label="Reply or note">
        <TabsTrigger value="reply">Public reply</TabsTrigger>
        <TabsTrigger value="note">Internal note</TabsTrigger>
      </TabsList>
      <TabsContent value="reply" className="text-sm text-muted-foreground">
        Visible to the guest.
      </TabsContent>
      <TabsContent value="note" className="text-sm text-muted-foreground">
        Visible to your team only.
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('tab', { name: 'Public reply' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // No underline recipe on a pill: the chosen mode is the white chip.
    expect(canvasElement.querySelector('[data-variant="default"]')).not.toBeNull()
    expect(canvasElement.querySelector('.border-b')).toBeNull()
  },
}

export const RouteViewsLight: Story = { ...RouteViews, parameters: { theme: 'light' } }
export const PanelViewsLight: Story = { ...PanelViews, parameters: { theme: 'light' } }
export const ComponentModeLight: Story = {
  ...ComponentMode,
  parameters: { theme: 'light' },
}
