// How a page switches between its sibling views (UI consistency scan: NAV-04,
// COLL-01, COLL-11). One underline look, two elements: `LinkTabs` when each view
// is a route (a navigation landmark of links with `aria-current`) and
// `Tabs variant="line"` when the views swap a panel in the same document. The grey
// pill stays for a mode inside a component. Dark is the default theme; the light
// variants draw the same rows on the light surface (axe runs on both).
//
// A `LinkTab` is a router link, so a click would navigate the story's memory router
// to a route it has no page for: the stories keep the view in state and stop the
// navigation in the click handler, as a real page's view comes from its route.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { tailwindIsCompiled } from '../../../.storybook/tailwind-compiled'
import { LinkTab, LinkTabs } from './link-tabs'
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

/**
 * The strip's layout where Tailwind is not compiled (the Vitest story runner): the
 * classes are inert there, so the scrolling row stands in for them. Where Tailwind
 * is compiled the classes are what is measured and nothing stands in.
 */
const STRIP_LAYOUT = `
  [data-slot='link-tabs'] { display: flex; overflow-x: auto; scrollbar-width: none; }
  [data-slot='link-tabs'] ul { display: flex; gap: 4px; min-width: max-content; }
  [data-slot='link-tabs'] a { display: block; padding: 0 12px; white-space: nowrap; }
`

const meta: Meta = {
  title: 'Patterns/View tabs',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <>
        {tailwindIsCompiled() ? null : <style>{STRIP_LAYOUT}</style>}
        <Story />
      </>
    ),
  ],
}

export default meta
type Story = StoryObj

type View = 'active' | 'archived'

function PageViews({ initial }: Readonly<{ initial: View }>) {
  const [view, setView] = useState<View>(initial)
  const go = (next: View) => (event: React.MouseEvent) => {
    event.preventDefault()
    setView(next)
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <LinkTabs aria-label="Which reports">
        <LinkTab to="/inbox" current={view === 'active'} onClick={go('active')}>
          Active
          <TabCount>6</TabCount>
        </LinkTab>
        <LinkTab to="/portals" current={view === 'archived'} onClick={go('archived')}>
          Archived
          <TabCount>1</TabCount>
        </LinkTab>
      </LinkTabs>
      <p className="text-sm text-muted-foreground">
        {view === 'active' ? 'The reports in use.' : 'Reports kept for the record.'}
      </p>
    </div>
  )
}

/** Views that are a route: a named landmark of links, the current one marked. */
export const RouteViews: Story = {
  render: () => <PageViews initial="active" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Which reports' })
    // Not a tablist: nothing here swaps a panel in the same document.
    expect(canvas.queryByRole('tablist')).toBeNull()
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    const activeView = within(nav).getByRole('link', { name: /Active\s*6/ })
    expect(activeView).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Archived\s*1/ })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** Choosing a view moves `aria-current` with it, and the count stays in the name. */
export const ChoosingAView: Story = {
  render: () => <PageViews initial="active" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const archived = canvas.getByRole('link', { name: /Archived\s*1/ })
    const active = canvas.getByRole('link', { name: /Active\s*6/ })
    await userEvent.click(archived)
    expect(archived).toHaveAttribute('aria-current', 'page')
    expect(active).not.toHaveAttribute('aria-current')
    expect(canvas.getByText('Reports kept for the record.')).toBeVisible()
  },
}

/** Every link is one Tab stop, in order, with the same focus ring as the rest. */
export const KeyboardOrder: Story = {
  render: () => <PageViews initial="active" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: /Active\s*6/ })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: /Archived\s*1/ })).toHaveFocus()
  },
}

const PORTAL_TABS = ['Page', 'Share', 'Results', 'History'] as const

/** The Portal workspace's row of tabs in a space too narrow for all four. */
function PortalStrip({ current }: Readonly<{ current: (typeof PORTAL_TABS)[number] }>) {
  return (
    <div style={{ width: 240 }}>
      <LinkTabs aria-label="Portal sections">
        {PORTAL_TABS.map((label) => (
          <LinkTab
            key={label}
            to="/portals"
            current={label === current}
            onClick={(event) => event.preventDefault()}
          >
            {label}
          </LinkTab>
        ))}
      </LinkTabs>
    </div>
  )
}

function portalStrip(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole('navigation', { name: 'Portal sections' })
}

/**
 * A narrow phone keeps the strip to one row that scrolls sideways (the list is
 * `overflow-x-auto` over a `min-w-max` row) with its scrollbar hidden, and each
 * link is a tap target (`min-h-(--control-touch)`).
 */
export const PhoneStrip: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  render: () => <PortalStrip current="Share" />,
  play: async ({ canvasElement }) => {
    const nav = portalStrip(canvasElement)
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([...PORTAL_TABS])
    expect(within(nav).getByRole('link', { name: 'Share' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(nav.className).toContain('overflow-x-auto')
    expect(nav.className).toContain('[scrollbar-width:none]')
    expect(nav.querySelector('ul')?.className).toContain('min-w-max')
  },
}

/**
 * A deep link to the last tab opens with that tab in view, not off the edge, and
 * the side that continues is faded.
 */
export const StripOpensOnTheLastTab: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  render: () => <PortalStrip current="History" />,
  play: async ({ canvasElement }) => {
    const nav = portalStrip(canvasElement)
    const current = within(nav).getByRole('link', { name: 'History' })
    expect(current).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0))
    await waitFor(() => {
      expect(current.getBoundingClientRect().right).toBeLessThanOrEqual(
        nav.getBoundingClientRect().right,
      )
    })
    await waitFor(() => expect(nav.style.maskImage).not.toBe(''))
  },
}

/**
 * Scrolling the row back to the start is the person's own move: the fade follows
 * the edge (the row re-renders), and the row does not pull itself back to the
 * current tab.
 */
export const StripStaysWhereItWasScrolled: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  render: () => <PortalStrip current="History" />,
  play: async ({ canvasElement }) => {
    const nav = portalStrip(canvasElement)
    await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0))
    await waitFor(() => expect(nav.style.maskImage).not.toBe(''))

    const fadedAtTheEnd = nav.style.maskImage
    nav.scrollLeft = 0
    await waitFor(() => expect(nav.style.maskImage).not.toBe(fadedAtTheEnd))
    expect(nav.scrollLeft).toBe(0)
  },
}

export const StripOpensOnTheLastTabLight: Story = {
  ...StripOpensOnTheLastTab,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' }, theme: 'light' },
}

const GROWN_LABEL = 'History and audit trail'

/**
 * A row whose last tab widens after the first paint, as a web font arriving or a
 * count appearing does: it fits when it mounts and overflows a moment later.
 */
function GrowingStrip() {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), 50)
    return () => clearTimeout(timer)
  }, [])
  const tabs = [
    { id: 'page', label: 'Page' },
    { id: 'share', label: 'Share' },
    { id: 'results', label: 'Results' },
    { id: 'history', label: grown ? GROWN_LABEL : 'History' },
  ]
  return (
    <div style={{ width: 340 }}>
      <LinkTabs aria-label="Portal sections">
        {tabs.map((tab) => (
          <LinkTab
            key={tab.id}
            to="/portals"
            current={tab.id === 'history'}
            onClick={(event) => event.preventDefault()}
          >
            {tab.label}
          </LinkTab>
        ))}
      </LinkTabs>
    </div>
  )
}

/**
 * The current tab is brought into view when the row only comes to overflow after
 * it mounted (the first reveal found nothing to scroll), as long as the person has
 * not scrolled the row meanwhile.
 */
export const StripRevealsAfterTheRowGrows: Story = {
  render: () => <GrowingStrip />,
  play: async ({ canvasElement }) => {
    const nav = portalStrip(canvasElement)
    const current = await within(nav).findByRole('link', { name: GROWN_LABEL })
    await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0))
    await waitFor(() => {
      expect(current.getBoundingClientRect().right).toBeLessThanOrEqual(
        nav.getBoundingClientRect().right,
      )
    })
  },
}

/** When every tab fits there is nothing out of reach, so no fade is drawn. */
export const StripThatFits: Story = {
  render: () => <PageViews initial="active" />,
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Which reports' })
    expect(nav.style.maskImage).toBe('')
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
