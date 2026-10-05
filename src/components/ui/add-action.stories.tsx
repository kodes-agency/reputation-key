// The control that adds a thing to a list (UI consistency scan: COLL-21, ACT-14,
// FRAME-12): the default Button with a Plus before a sentence-case label. A page's
// primary add sits in its header; a card or a tab that owns a list may carry its own.
// Its height is the Button's (36px, 44px on a phone), so no page restyles it. Dark is
// the default theme; the light variant renders the same row on the light surface
// (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { ChevronDown } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AddAction, AddActionLink } from './add-action'

const meta: Meta<typeof AddAction> = {
  title: 'Patterns/Add action',
  component: AddAction,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { onClick: fn() },
}

export default meta
type Story = StoryObj<typeof AddAction>

function Row({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AddActionLink to="/properties/import-google">Import from Google</AddActionLink>
      <AddAction onClick={onClick}>Invite member</AddAction>
      <AddAction variant="outline" onClick={onClick}>
        Add portal
      </AddAction>
      <AddAction onClick={onClick}>
        New portal
        <ChevronDown aria-hidden />
      </AddAction>
      <AddAction variant="ghost" size="sm" onClick={onClick}>
        Add link
      </AddAction>
      <AddAction disabled onClick={onClick}>
        New goal
      </AddAction>
    </div>
  )
}

/** A page that is made elsewhere is a link; the rest open a dialog or a menu, or run. */
export const Default: Story = {
  render: (args) => <Row onClick={args.onClick ?? (() => undefined)} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: 'Import from Google' })
    expect(link).toHaveAttribute('href', '/properties/import-google')
    expect(link).toHaveAttribute('data-variant', 'default')
    const button = canvas.getByRole('button', { name: 'Invite member' })
    expect(button).toHaveAttribute('data-size', 'default')
    await userEvent.click(button)
    expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

/** The Plus is the one glyph, before the label, drawn for the eye only and never sized by the caller. */
export const OnePlus: Story = {
  render: (args) => <Row onClick={args.onClick ?? (() => undefined)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of ['Invite member', 'Add portal', 'Add link']) {
      const button = canvas.getByRole('button', { name })
      const plus = button.querySelector('svg.lucide-plus')
      expect(plus).not.toBeNull()
      expect(plus).toHaveAttribute('aria-hidden', 'true')
      expect(plus?.getAttribute('class') ?? '').not.toMatch(/\bsize-|\bmr-/u)
      expect(button.firstElementChild).toBe(plus)
    }
  },
}

/** A disabled add is a disabled Button; the page says why beside it. */
export const Disabled: Story = {
  render: (args) => <Row onClick={args.onClick ?? (() => undefined)} />,
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'New goal' })).toBeDisabled()
  },
}

/** The same row on the light surface. */
export const DefaultLight: Story = {
  parameters: { theme: 'light' },
  render: (args) => <Row onClick={args.onClick ?? (() => undefined)} />,
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('link', { name: 'Import from Google' }),
    ).toBeVisible()
    expect(
      within(canvasElement).getByRole('button', { name: 'New portal' }),
    ).toBeVisible()
  },
}
