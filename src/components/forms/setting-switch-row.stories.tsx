// SettingSwitchRow: one row for a boolean setting. Dark is the default theme; the light
// variants render the same rows on the light surface (axe runs on both). The Storybook
// Vitest project compiles no Tailwind, so the plays pin behaviour and wiring (the label
// names the switch, a row that saves as it is flipped says Saving while it runs, a row
// the group saves says nothing), not placement.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SettingSwitchRow } from './setting-switch-row'

/** A row that saves as it is flipped: the request takes a moment, as a network does. */
function ImmediateRow({ delayMs = 150 }: Readonly<{ delayMs?: number }>) {
  const [checked, setChecked] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <div className="max-w-xl">
      <SettingSwitchRow
        id="story-urgent"
        label="Let urgent email through anyway"
        description="Urgent notices ignore your quiet hours."
        commit="immediate"
        checked={checked}
        pending={pending}
        onCheckedChange={(next) => {
          setPending(true)
          setTimeout(() => {
            setChecked(next)
            setPending(false)
          }, delayMs)
        }}
      />
    </div>
  )
}

/** A row that is one field of a group: the group's Save carries it. */
function DeferredRow() {
  const [checked, setChecked] = useState(false)
  return (
    <div className="max-w-xl">
      <SettingSwitchRow
        id="story-emoji"
        label="Allow emoji in rendered templates"
        commit="deferred"
        checked={checked}
        onCheckedChange={setChecked}
      />
    </div>
  )
}

function LockedRow() {
  return (
    <div className="max-w-xs">
      <SettingSwitchRow
        id="story-in-app"
        label="In-app"
        accessibleName="Action needed: In-app"
        note="Always on"
        commit="immediate"
        checked
        disabled
        onCheckedChange={() => undefined}
      />
    </div>
  )
}

function CellRow() {
  const [checked, setChecked] = useState(true)
  return (
    <SettingSwitchRow
      id="story-cell"
      layout="cell"
      label="Enabled: General appreciation"
      stateWords={['On', 'Off']}
      commit="immediate"
      checked={checked}
      onCheckedChange={setChecked}
    />
  )
}

const meta: Meta = {
  title: 'Patterns/Setting switch row',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** Flipping a row that saves at once says Saving while the request runs, and the switch waits. */
export const Immediate: Story = {
  render: () => <ImmediateRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const urgent = canvas.getByRole('switch', { name: 'Let urgent email through anyway' })
    expect(urgent).not.toBeChecked()
    expect(urgent).toHaveAccessibleDescription('Urgent notices ignore your quiet hours.')
    expect(canvas.queryByRole('status')).toBeNull()

    await userEvent.click(urgent)
    expect(await canvas.findByRole('status')).toHaveTextContent('Saving…')
    expect(urgent).toBeDisabled()

    await waitFor(() => expect(urgent).toBeChecked())
    expect(canvas.queryByRole('status')).toBeNull()
    expect(urgent).toBeEnabled()
  },
}

export const ImmediateLight: Story = { ...Immediate, parameters: { theme: 'light' } }

/** A row the group saves has no status of its own: it moves, and the group's Save carries it. */
export const Deferred: Story = {
  render: () => <DeferredRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const emoji = canvas.getByRole('switch', {
      name: 'Allow emoji in rendered templates',
    })

    await userEvent.click(emoji)
    expect(emoji).toBeChecked()
    expect(canvas.queryByRole('status')).toBeNull()
  },
}

export const DeferredLight: Story = { ...Deferred, parameters: { theme: 'light' } }

/** A setting that cannot change says why in a note, which is the switch's description. */
export const Locked: Story = {
  render: () => <LockedRow />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const inApp = canvas.getByRole('switch', { name: 'Action needed: In-app' })

    expect(inApp).toBeDisabled()
    expect(inApp).toBeChecked()
    expect(inApp).toHaveAccessibleDescription('Always on')
  },
}

export const LockedLight: Story = { ...Locked, parameters: { theme: 'light' } }

/** In a table cell the label is read but not drawn, and the state is in words beside the switch. */
export const Cell: Story = {
  render: () => <CellRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const enabled = canvas.getByRole('switch', { name: 'Enabled: General appreciation' })
    expect(canvas.getByText('On')).toBeVisible()

    await userEvent.click(enabled)
    expect(canvas.getByText('Off')).toBeVisible()
    expect(canvas.queryByText('On')).toBeNull()
  },
}

export const CellLight: Story = { ...Cell, parameters: { theme: 'light' } }
