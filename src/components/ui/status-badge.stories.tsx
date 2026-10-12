// A domain status as a pill (UI consistency scan: COLL-05). The feature writes
// its words once as a StatusMap; the badge takes the tone, the one icon that
// tone wears, and the label. It never prints the stored token, and a status the
// map does not know reads "Unknown". Dark is the default theme; the light
// variant renders the same row on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { StatusBadge, type StatusMap } from './status-badge'

type Connection = 'active' | 'reauth_required' | 'disconnected' | 'failed'

const CONNECTION: StatusMap<Connection> = {
  active: { label: 'Connected', tone: 'positive' },
  reauth_required: { label: 'Needs attention', tone: 'warn' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  failed: { label: 'Connection unavailable', tone: 'negative' },
}

const meta: Meta<typeof StatusBadge> = {
  title: 'Patterns/Status badge',
  component: StatusBadge,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof StatusBadge>

/** Every status of a domain, through one map: label, tone and icon follow the status. */
export const FromAMap: Story = {
  render: () => (
    <ul className="flex flex-wrap items-center gap-2">
      {(Object.keys(CONNECTION) as Connection[]).map((status) => (
        <li key={status}>
          <StatusBadge status={status} map={CONNECTION} />
        </li>
      ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Connected')).toHaveAttribute('data-variant', 'positive')
    expect(canvas.getByText('Needs attention')).toHaveAttribute('data-variant', 'warn')
    expect(canvas.getByText('Disconnected')).toHaveAttribute('data-variant', 'neutral')
    expect(canvas.getByText('Connection unavailable')).toHaveAttribute(
      'data-variant',
      'negative',
    )
    // The stored token is never on screen.
    expect(canvas.queryByText('reauth_required')).toBeNull()
    // One icon each, hidden from the accessibility tree.
    for (const badge of canvasElement.querySelectorAll('[data-slot="badge"]')) {
      expect(badge.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    }
  },
}

/** A state with no status enum behind it takes a tone and a label directly. */
export const ToneAndLabel: Story = {
  args: { tone: 'warn', label: 'Re-consent needed' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Re-consent needed')).toHaveAttribute(
      'data-variant',
      'warn',
    )
  },
}

/** A status that escaped the types (a server newer than the page) is neutral and honest. */
export const UnknownStatus: Story = {
  render: () => <StatusBadge status="archived_by_support" map={CONNECTION} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Unknown')).toHaveAttribute('data-variant', 'neutral')
    expect(canvas.queryByText('archived_by_support')).toBeNull()
  },
}

export const FromAMapLight: Story = { ...FromAMap, parameters: { theme: 'light' } }
