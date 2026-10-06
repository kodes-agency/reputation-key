// The one way back (UI consistency scan: ACT-12, FRAME-09, NAV-10): a ghost, small
// Button with the one arrow. A page with breadcrumbs goes up through them; this is for
// a surface that has no room for a trail (a full-bleed workspace header, the Inbox's
// detail pane) and for a step that returns to the one before. `BackLink` goes to an
// address, `BackButton` changes what the page shows, and they look the same. Dark is
// the default theme; the light variants render the same rows on the light surface
// (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { BackIconButton } from './back-icon-button'
import { BackButton, BackLink } from './back-link'

const meta: Meta<typeof BackLink> = {
  title: 'Patterns/Back link',
  component: BackLink,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof BackLink>

// Every row wears the page's own side gutter, as the real surfaces do (the workspace
// header and `<main>` both use `PAGE_GUTTER_X`), so a row's left inset is the app's and
// not the story's. What is left between the rows is `flush`: a header's first control
// puts its arrow on the gutter, a control in the body puts its box there.

/** A workspace header's first control: `flush` puts the arrow, not the box, on the gutter. */
function HeaderRow({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`flex items-center gap-3 border-b py-2 ${PAGE_GUTTER_X}`}>
      {children}
      <p className="border-l pl-3 text-base font-semibold">Arrival and welcome</p>
    </div>
  )
}

function Rows({ onBack }: Readonly<{ onBack: () => void }>) {
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <HeaderRow>
        <BackLink to="/portals" label="Back to portals" flush />
      </HeaderRow>
      <HeaderRow>
        <BackIconButton label="Back to list" flush onClick={onBack} />
      </HeaderRow>
      <div
        className={`flex items-center justify-between gap-3 border-t pt-4 ${PAGE_GUTTER_X}`}
      >
        <BackButton label="Back to questions" onClick={onBack} />
        <span className="text-sm text-muted-foreground">Step 2 of 2</span>
      </div>
    </div>
  )
}

/** A link names a place: the arrow, then "Back to <place>". It is never announced as current. */
export const AsLink: Story = {
  render: () => <Rows onBack={() => undefined} />,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Back to portals' })
    expect(link).toHaveAttribute('href', '/portals')
    expect(link).toHaveAttribute('data-variant', 'ghost')
    expect(link).toHaveAttribute('data-size', 'sm')
    expect(link).not.toHaveAttribute('aria-current')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  },
}

/** A button changes what the page shows, and reads as the same control. */
export const AsButton: Story = {
  args: {},
  render: () => {
    const onBack = fn()
    return <Rows onBack={onBack} />
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Back to questions',
    })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'sm')
    await userEvent.click(button)
  },
}

/** Only the arrow, for a row with no room for words: the label is still its name and its tooltip. */
export const ArrowOnly: Story = {
  render: () => <Rows onBack={() => undefined} />,
  play: async ({ canvasElement }) => {
    const back = within(canvasElement).getByRole('button', { name: 'Back to list' })
    expect(back).toHaveAttribute('data-size', 'icon-sm')
    expect(back).toHaveTextContent('')
    await userEvent.hover(back)
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Back to list'),
    )
  },
}

/** `iconBelow` keeps the words for a screen reader while a narrow row shows only the arrow. */
export const WordsHiddenBelowSm: Story = {
  render: () => (
    <HeaderRow>
      <BackLink to="/portals" label="Back to portals" iconBelow="sm" flush />
    </HeaderRow>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Back to portals' })
    expect(link.className).toContain('max-sm:w-(--control-touch)')
    expect(link.querySelector('span')?.className).toContain('sr-only')
  },
}

/** The same rows on the light surface. */
export const AsLinkLight: Story = {
  parameters: { theme: 'light' },
  render: () => <Rows onBack={() => undefined} />,
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('link', { name: 'Back to portals' }),
    ).toBeVisible()
    expect(
      within(canvasElement).getByRole('button', { name: 'Back to list' }),
    ).toBeVisible()
    expect(
      within(canvasElement).getByRole('button', { name: 'Back to questions' }),
    ).toBeVisible()
  },
}
