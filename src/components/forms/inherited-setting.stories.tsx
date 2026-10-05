// InheritedSetting: "follow the parent, or set my own", in both commit modes. Dark is
// the default theme; the light variants render the same row on the light surface (axe
// runs on both). The Storybook Vitest project compiles no Tailwind, so the plays pin
// behaviour and wiring (what the row says it follows, the button that swaps the state,
// the link to the owner, the busy button while an immediate row saves), not colours.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import { Input } from '#/components/ui/input'
import { InheritedSetting } from './inherited-setting'

/** Stands in for the utilities layer, which this runner does not compile: a link in a sentence stays underlined (axe link-in-text-block). */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

/** A Property's target in a group that saves on its Save: the buttons only change what Save will send. */
function DeferredTarget({
  startsOverridden = false,
}: Readonly<{ startsOverridden?: boolean }>) {
  const [overridden, setOverridden] = useState(startsOverridden)
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <style>{UTILITY_LAYER}</style>
      <InheritedSetting
        source={
          <InlineLink to="/settings/organization" underline="always">
            the Organization target
          </InlineLink>
        }
        value="24 hours"
        overridden={overridden}
        commit="deferred"
        inheritLabel="Use Organization target"
        overrideLabel="Set a Property target"
        onInherit={() => setOverridden(false)}
        onOverride={() => setOverridden(true)}
        note={
          overridden ? undefined : 'This remains linked to future Organization changes.'
        }
      />
      <Input
        aria-label="Property hours"
        type="number"
        defaultValue={48}
        disabled={!overridden}
        className="max-w-40"
      />
    </div>
  )
}

/** A Property's quiet hours: the buttons save at once, so the pressed button is busy while it runs. */
function ImmediateWindow() {
  const [overridden, setOverridden] = useState(true)
  const [pending, setPending] = useState(false)
  return (
    <div className="max-w-xl">
      <style>{UTILITY_LAYER}</style>
      <InheritedSetting
        source={
          <InlineLink to="/settings/notifications" underline="always">
            your quiet hours
          </InlineLink>
        }
        value="22:00 to 07:00"
        overridden={overridden}
        commit="immediate"
        pending={pending}
        inheritLabel="Follow my quiet hours here"
        overrideLabel="Use different hours here"
        onOverride={() => setOverridden(true)}
        onInherit={() => {
          setPending(true)
          setTimeout(() => {
            setOverridden(false)
            setPending(false)
          }, 150)
        }}
      />
    </div>
  )
}

/** A notification category: editing a control is what overrides, so there is no Override, and the row carries the person's other commands. */
function ImplicitOverride({ ownHere }: Readonly<{ ownHere: boolean }>) {
  return (
    <div className="max-w-xl">
      <InheritedSetting
        source="your default"
        overridden={ownHere}
        commit="immediate"
        inheritLabel="Use my default here"
        inheritAccessibleName="Workflow: Use my default here"
        onInherit={() => undefined}
        noteId="story-default-note"
        note="A new property gets in-app on, email off."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby="story-default-note"
        >
          Make this my default
        </Button>
      </InheritedSetting>
    </div>
  )
}

const meta: Meta = {
  title: 'Patterns/Inherited setting',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** While inherited it says what it follows and what that is worth, and links to the owner; Override starts a value of its own. */
export const DeferredInherited: Story = {
  render: () => <DeferredTarget />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Follows/)).toHaveTextContent(
      'Follows the Organization target, currently 24 hours.',
    )
    expect(canvas.getByRole('link', { name: 'the Organization target' })).toHaveAttribute(
      'href',
      '/settings/organization',
    )
    const hours = canvas.getByRole('spinbutton', { name: 'Property hours' })
    expect(hours).toBeDisabled()

    await userEvent.click(canvas.getByRole('button', { name: 'Set a Property target' }))

    expect(canvas.getByText(/Set here instead of/)).toHaveTextContent(
      'Set here instead of the Organization target (24 hours).',
    )
    expect(hours).toBeEnabled()
    // The same button, now the way back: the focus stays on it.
    const back = canvas.getByRole('button', { name: 'Use Organization target' })
    expect(back).toHaveFocus()
  },
}

export const DeferredInheritedLight: Story = {
  ...DeferredInherited,
  parameters: { theme: 'light' },
}

export const DeferredOverridden: Story = {
  render: () => <DeferredTarget startsOverridden />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('spinbutton', { name: 'Property hours' })).toBeEnabled()

    await userEvent.click(canvas.getByRole('button', { name: 'Use Organization target' }))

    expect(canvas.getByRole('spinbutton', { name: 'Property hours' })).toBeDisabled()
    expect(canvas.getByText(/Follows/)).toBeVisible()
  },
}

export const DeferredOverriddenLight: Story = {
  ...DeferredOverridden,
  parameters: { theme: 'light' },
}

/** An immediate row keeps its pressed button busy while the save runs, then shows the new state. */
export const ImmediateSaving: Story = {
  render: () => <ImmediateWindow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const follow = canvas.getByRole('button', { name: 'Follow my quiet hours here' })

    await userEvent.click(follow)
    await waitFor(() => expect(follow).toHaveAttribute('aria-busy', 'true'))
    expect(follow).toBeDisabled()

    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'Use different hours here' }),
      ).toBeVisible(),
    )
    expect(canvas.getByText(/Follows/)).toHaveTextContent(
      'Follows your quiet hours, currently 22:00 to 07:00.',
    )
  },
}

export const ImmediateSavingLight: Story = {
  ...ImmediateSaving,
  parameters: { theme: 'light' },
}

/** Where editing overrides, the row has no Override button, and its other commands sit before the way back. */
export const ImplicitOverrideHere: Story = {
  render: () => <ImplicitOverride ownHere />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const buttons = canvas.getAllByRole('button').map((button) => button.textContent)

    expect(buttons).toEqual(['Make this my default', 'Use my default here'])
    expect(
      canvas.getByRole('button', { name: 'Workflow: Use my default here' }),
    ).toBeVisible()
    expect(
      canvas.getByRole('button', { name: 'Make this my default' }),
    ).toHaveAccessibleDescription('A new property gets in-app on, email off.')
  },
}

export const ImplicitOverrideHereLight: Story = {
  ...ImplicitOverrideHere,
  parameters: { theme: 'light' },
}

/** Following the default, there is nothing to undo: only the row's own commands show. */
export const ImplicitOverrideFollowing: Story = {
  render: () => <ImplicitOverride ownHere={false} />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Make this my default',
    ])
    expect(canvas.getByText(/Follows/)).toHaveTextContent('Follows your default.')
  },
}
