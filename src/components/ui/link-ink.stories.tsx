// The link layer, drawn on the real components. `styles.css` gives a plain `<a>`
// the accent ink as a DEFAULT inside `@layer base`, so a utility on the anchor
// wins, and the anchors that belong to a component with its own ink (menu
// items, breadcrumbs, sidebar entries, buttons) opt out by `data-slot`.
//
// What this runner can prove. The Vitest story runner compiles no Tailwind, so
// the utility layer is empty here and no `text-*` class on a link can be read
// back. The plays therefore check the part of the cascade that does not need
// the classes: a plain link is accent, an anchor that opted out is NOT (it takes
// the ink of what it sits in), and a rule in the utilities layer beats the
// default. That last one stands the utility layer in with one rule, which is
// exactly the property that broke: the default used to sit outside every layer
// and beat it. The classes themselves (nav ink, the sidebar's fill, semibold
// and icon) are read in compiled Tailwind by
// `e2e/storybook-metrics/link-ink.metrics.ts`.
//
// Both themes run: the dark accent is lighter than the light one.
import type { Meta, StoryObj } from '@storybook/react'
import { Home } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Button } from './button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from './sidebar'

const meta: Meta = {
  title: 'Patterns/Link ink',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

/** Stands in for the utilities layer, which this runner does not compile. */
const UTILITY_LAYER = `@layer utilities {
  .link-ink-pinned { color: var(--muted-foreground); text-decoration-line: underline; }
}`

function Surface() {
  return (
    <div className="flex max-w-xl flex-col gap-6 text-sm">
      <style>{UTILITY_LAYER}</style>
      <span
        aria-hidden="true"
        hidden
        data-testid="accent-probe"
        style={{ color: 'var(--accent)' }}
      >
        .
      </span>

      <section aria-label="Content links" className="flex flex-col gap-2">
        <a href="#privacy" data-testid="content-link">
          Privacy notice
        </a>
        <a
          href="#terms"
          className="link-ink-pinned underline-offset-4"
          data-testid="pinned-link"
        >
          Terms of service
        </a>
      </section>

      <nav aria-label="Navigation links" className="flex gap-4">
        <a
          href="#overview"
          aria-current="page"
          className="font-medium text-foreground"
          data-testid="nav-active"
        >
          Overview
        </a>
        <a
          href="#ratings"
          className="text-muted-foreground transition-colors hover:text-foreground"
          data-testid="nav-inactive"
        >
          Ratings
        </a>
      </nav>

      <Breadcrumb>
        <BreadcrumbList data-testid="breadcrumb-list">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <a href="#properties" data-testid="breadcrumb-ancestor">
                Properties
              </a>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbPage>Harbour View</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex gap-3">
        <Button asChild>
          <a href="#new" data-testid="button-link">
            New portal
          </a>
        </Button>
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Account</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="menu">
            <DropdownMenuItem asChild>
              <a href="#properties" data-testid="menu-link">
                Properties
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild variant="destructive">
              <a href="#remove" data-testid="menu-link-destructive">
                Remove from workspace
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SidebarProvider className="min-h-0 w-64">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive>
              <a href="#dashboard" data-testid="sidebar-active">
                <Home />
                <span>Dashboard</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#reviews" data-testid="sidebar-inactive">
                <Home />
                <span>Reviews</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
    </div>
  )
}

const play: NonNullable<Story['play']> = ({ canvasElement }) => {
  const root = within(canvasElement.ownerDocument.body)
  const ink = (testId: string) => getComputedStyle(root.getByTestId(testId)).color
  const accent = ink('accent-probe')

  // A plain link is a content link: the accent, undecorated until it says so.
  expect(ink('content-link')).toBe(accent)
  expect(getComputedStyle(root.getByTestId('content-link')).textDecorationLine).toBe(
    'none',
  )

  // A rule in the utilities layer beats the default, ink and decoration both.
  expect(ink('pinned-link')).not.toBe(accent)
  expect(getComputedStyle(root.getByTestId('pinned-link')).textDecorationLine).toBe(
    'underline',
  )

  // An anchor that belongs to a component takes the ink of what it sits in.
  expect(ink('breadcrumb-ancestor')).toBe(ink('breadcrumb-list'))
  expect(ink('menu-link')).toBe(ink('menu'))

  // And is never the content-link accent.
  for (const testId of [
    'breadcrumb-ancestor',
    'button-link',
    'menu-link',
    'menu-link-destructive',
    'sidebar-active',
    'sidebar-inactive',
  ]) {
    expect(ink(testId), `${testId} must not take the content-link ink`).not.toBe(accent)
  }
}

export const Dark: Story = {
  render: () => <Surface />,
  play,
}

export const Light: Story = {
  render: () => <Surface />,
  parameters: { theme: 'light' },
  play,
}
