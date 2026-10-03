// A section nav: the sections of one place as links, with an optional icon, summary,
// count and group heading (UI consistency scan: NAV-01, NAV-05, NAV-07, NAV-09,
// FORM-07). Dark is the default theme; the light variants render the same navs on
// the light surface (axe runs on both).
//
// What the Vitest runner can prove. No Tailwind is compiled here, so classes and
// container queries are inert: the plays check structure, the one `aria-current`
// row, focus and the strip's behaviour. `STRIP_LAYOUT` stands in for the layout
// the strip's scrolling needs, only where Tailwind is missing; where it is compiled
// (Storybook proper) the container-driven plays also read the real layout.
import type { Meta, StoryObj } from '@storybook/react'
import { Bell, Building2, Palette, Shield, User, Users } from 'lucide-react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { NavCount } from './nav-count'
import { SectionNav } from './section-nav'
import { SectionNavLayout } from './section-nav-layout'
import type { SectionNavItem } from './section-nav-types'

/** Whether Tailwind is compiled here: Storybook proper is, the Vitest runner is not. */
function tailwindIsCompiled(): boolean {
  const probe = document.createElement('div')
  probe.className = 'hidden'
  document.body.append(probe)
  const compiled = getComputedStyle(probe).display === 'none'
  probe.remove()
  return compiled
}

const STRIP_LAYOUT = `
  [data-slot='section-nav-scroller'] {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 0 16px;
    scrollbar-width: none;
  }
  [data-slot='section-nav-scroller'] > div { display: contents; }
  [data-slot='section-nav-scroller'] ul { display: flex; gap: 4px; }
  [data-slot='section-nav-scroller'] li { flex-shrink: 0; }
  [data-slot='section-nav-scroller'] a { white-space: nowrap; display: block; }
  [data-slot='section-nav-scroller'] [data-slot='section-nav-label'] { display: inline; }
  [data-presentation='strip'] [data-slot='section-nav-summary'],
  [data-presentation='strip'] [data-slot='section-nav-heading'] { display: none; }
`

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'

const section = (
  key: string,
  label: string,
  summary: string,
  extra: Partial<SectionNavItem> = {},
): SectionNavItem => ({
  key,
  to: `/properties/$propertyId/settings/${key}`,
  params: { propertyId: PROPERTY_ID },
  label,
  summary,
  ...extra,
})

const HUB: ReadonlyArray<SectionNavItem> = [
  section('profile', 'Profile', 'Name, country, timezone and public display name'),
  section('google', 'Google', 'Business Profile link and review source'),
  section('replies', 'Replies', 'Reply language, voice and templates'),
  section('ai', 'AI', 'AI features, data use and analysis progress'),
  section('people', 'People', 'Responsible managers'),
  section('targets', 'Targets', 'Response and handling targets'),
  section('danger', 'Danger zone', 'Disconnect, archive, remove or restore', {
    group: 'danger',
  }),
]

const ACCOUNT: ReadonlyArray<SectionNavItem> = [
  section('profile', 'Profile', 'Your name and photo', { icon: User, group: 'You' }),
  section('security', 'Security', 'Password and sessions', {
    icon: Shield,
    group: 'You',
  }),
  section('preferences', 'Preferences', 'Theme and language', {
    icon: Palette,
    group: 'You',
  }),
  section('notifications', 'Notifications', 'What reaches you', {
    icon: Bell,
    group: 'You',
    count: 3,
  }),
  section('organization', 'Organization', 'Name and branding', {
    icon: Building2,
    group: 'Organization',
  }),
  section('members', 'Members', 'Who can sign in', {
    icon: Users,
    group: 'Organization',
    count: 12,
  }),
]

const meta: Meta<typeof SectionNav> = {
  title: 'Patterns/Section nav',
  component: SectionNav,
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
  args: {
    'aria-label': 'Property settings sections',
    items: HUB,
    current: 'google',
    groupHeadings: false,
  },
}

export default meta
type Story = StoryObj<typeof SectionNav>

function nav(canvasElement: HTMLElement, name = 'Property settings sections') {
  return within(canvasElement).getByRole('navigation', { name })
}

function currentLinks(root: HTMLElement) {
  return within(root)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
}

/**
 * A list: icon, label, a summary line, a trailing count and group headings, in a
 * column. The current row is the sidebar's accent-muted fill, drawn from the one
 * `aria-current`, and each group's list is named by its heading.
 */
export const List: Story = {
  args: {
    'aria-label': 'Account settings',
    items: ACCOUNT,
    current: 'notifications',
    presentation: 'list',
    groupHeadings: true,
  },
  render: (args) => (
    <div className="w-72">
      <SectionNav {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = nav(canvasElement, 'Account settings')
    const links = within(root).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      'page',
      null,
      null,
    ])
    expect(within(root).getByRole('list', { name: 'You' })).toBeVisible()
    expect(within(root).getByRole('list', { name: 'Organization' })).toBeVisible()
    // The count follows its label, so the name reads "Members 12".
    expect(within(root).getByRole('link', { name: /^Members.*12$/ })).toBeVisible()
    expect(root).toHaveAttribute('data-presentation', 'list')
  },
}

export const ListLight: Story = {
  ...List,
  parameters: { layout: 'padded', theme: 'light' },
}

/** The same sections without headings: the Danger zone is still a group apart. */
export const WithoutHeadings: Story = {
  args: { presentation: 'list', current: 'danger' },
  render: (args) => (
    <div className="w-72">
      <SectionNav {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = nav(canvasElement)
    expect(root.querySelectorAll('ul')).toHaveLength(2)
    expect(root.querySelector('p')).toBeNull()
    expect(currentLinks(root).map((link) => link.textContent)).toEqual([
      expect.stringContaining('Danger zone'),
    ])
  },
}

/**
 * A strip: one scrolling row for a narrow space. The row keeps the current section
 * in view (the last one here, so it is scrolled to) and fades the side that
 * continues; summaries and headings belong to the list.
 */
export const StripOpenOnTheLastSection: Story = {
  args: { presentation: 'strip', current: 'danger' },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const root = nav(canvasElement)
    const scroller = root.querySelector<HTMLElement>('[data-slot="section-nav-scroller"]')
    const current = currentLinks(root)[0]
    expect(scroller).not.toBeNull()
    expect(current).toHaveTextContent('Danger zone')
    if (tailwindIsCompiled() || scroller === null) return
    await waitFor(() => expect(scroller.scrollLeft).toBeGreaterThan(0))
    await waitFor(() => {
      const view = scroller.getBoundingClientRect()
      const item = current?.getBoundingClientRect()
      expect(item?.right).toBeLessThanOrEqual(view.right)
    })
    await waitFor(() => expect(scroller.style.maskImage).not.toBe(''))
  },
}

export const StripLight: Story = {
  ...StripOpenOnTheLastSection,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' }, theme: 'light' },
}

/** When every item fits there is nothing out of reach, so no fade is drawn. */
export const StripThatFits: Story = {
  args: { presentation: 'strip', current: 'profile', items: HUB.slice(0, 3) },
  play: async ({ canvasElement }) => {
    const scroller = nav(canvasElement).querySelector<HTMLElement>(
      '[data-slot="section-nav-scroller"]',
    )
    expect(scroller?.style.maskImage ?? '').toBe('')
  },
}

/**
 * `auto` in a narrow space: a strip. A container query cannot be read in the Vitest
 * runner; where Tailwind is compiled the play checks the row.
 */
export const AutoInANarrowSpace: Story = {
  args: { current: 'people' },
  render: (args) => (
    <div style={{ width: '26rem' }}>
      <SectionNavLayout frame="inline">
        <SectionNav {...args} />
        <p>Section content</p>
      </SectionNavLayout>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = nav(canvasElement)
    expect(root).toHaveAttribute('data-presentation', 'auto')
    if (!tailwindIsCompiled()) return
    const scroller = root.querySelector('[data-slot="section-nav-scroller"]')
    expect(getComputedStyle(scroller as Element).flexDirection).toBe('row')
  },
}

/** `auto` in a wide space: a column beside the content, the summaries showing. */
export const AutoInAWideSpace: Story = {
  args: { current: 'people' },
  render: (args) => (
    <div style={{ width: '60rem' }}>
      <SectionNavLayout frame="inline">
        <SectionNav {...args} />
        <p>Section content</p>
      </SectionNavLayout>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = nav(canvasElement)
    if (!tailwindIsCompiled()) return
    const scroller = root.querySelector('[data-slot="section-nav-scroller"]')
    expect(getComputedStyle(scroller as Element).flexDirection).toBe('column')
    expect(within(root).getByText('Responsible managers')).toBeVisible()
  },
}

export const AutoInAWideSpaceLight: Story = {
  ...AutoInAWideSpace,
  parameters: { layout: 'padded', theme: 'light' },
}

/** Tab reaches a row; the keyboard focus ring is the shared `focus-ring` utility. */
export const KeyboardFocus: Story = {
  args: { presentation: 'list', current: 'profile' },
  render: (args) => (
    <div className="w-72">
      <SectionNav {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const links = within(nav(canvasElement)).getAllByRole('link')
    await userEvent.tab()
    expect(links[0]).toHaveFocus()
    expect(links[0]?.className).toContain('focus-ring')
    await userEvent.tab()
    expect(links[1]).toHaveFocus()
  },
}

/** A count is a tabular figure at the row's end; it is red only when it is urgent. */
export const Counts: Story = {
  render: () => (
    <div className="flex w-72 items-center justify-between rounded-md border px-3 py-2 text-sm">
      Needs reply <NavCount>12</NavCount>
      Escalated <NavCount tone="negative">2</NavCount>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('12').className).toContain('tabular-nums')
    expect(canvas.getByText('2').className).toContain('text-negative')
  },
}
