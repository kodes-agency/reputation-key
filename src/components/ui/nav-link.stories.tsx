// A nav link names its own current page (UI consistency scan: NAV-09). The router
// marks a link current whenever the location is at or below its path, so the first
// link here, which points at an ancestor of the page the story sits on, is one the
// router would announce: NavLink announces only the row the nav says is current.
// Dark is the default theme; the light variant renders the same list on the light
// surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { NavLink } from './nav-link'

type Target = Readonly<{ to: string; label: string }>

// The story's memory router sits at `/_authenticated/`, so the first target is an
// ancestor of the open page and the others are elsewhere.
const TARGETS: ReadonlyArray<Target> = [
  { to: '/_authenticated', label: 'Everything under here' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/portals', label: 'Portals' },
]

const ROW =
  'flex min-h-9 items-center rounded-md px-3 text-sm text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium'

function Demo({ current }: Readonly<{ current: string }>) {
  return (
    <nav aria-label="Demo sections" className="w-64">
      <ul className="flex flex-col gap-1">
        {TARGETS.map((target) => (
          <li key={target.label}>
            <NavLink {...target} current={target.label === current} className={ROW}>
              {target.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const meta: Meta<typeof Demo> = {
  title: 'Patterns/Nav link',
  component: Demo,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { current: 'Inbox' },
}

export default meta
type Story = StoryObj<typeof Demo>

function currentLinks(canvasElement: HTMLElement) {
  return within(canvasElement)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
}

/** One link is the current page: the one the nav names, whatever the router matches. */
export const OneCurrentPage: Story = {
  play: async ({ canvasElement }) => {
    const current = currentLinks(canvasElement)

    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Inbox')
    // The router's own marks are gone, so a style cannot follow the router.
    expect(canvasElement.querySelector('[data-status]')).toBeNull()
  },
}

export const OneCurrentPageLight: Story = {
  ...OneCurrentPage,
  parameters: { layout: 'padded', theme: 'light' },
}

/** An ancestor link is not current just because the page is below it. */
export const AnAncestorIsNotCurrent: Story = {
  args: { current: 'Portals' },
  play: async ({ canvasElement }) => {
    const ancestor = within(canvasElement).getByRole('link', {
      name: 'Everything under here',
    })

    expect(ancestor).not.toHaveAttribute('aria-current')
    expect(currentLinks(canvasElement).map((link) => link.textContent)).toEqual([
      'Portals',
    ])
  },
}

/** No row is current when the nav is on none of its pages. */
export const NoneCurrent: Story = {
  args: { current: '' },
  play: async ({ canvasElement }) => {
    expect(currentLinks(canvasElement)).toHaveLength(0)
  },
}
