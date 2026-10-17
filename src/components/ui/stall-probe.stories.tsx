// TEMPORARY, never to merge: a probe for the storybook stall guard
// (scripts/ci/storybook-stall-guard.ts). Its second story's play function
// blocks the page's main thread for good, which is what a frozen story page
// looks like from Vitest: no JavaScript runs, so no test timeout can fire.
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta = {
  title: 'Diagnostics/Stall probe',
  render: () => <p>Stall probe</p>,
}

export default meta
type Story = StoryObj

export const RendersFirst: Story = {}

export const FreezesTheMainThread: Story = {
  play: () => {
    for (;;) {
      // never yields
    }
  },
}

export const NeverReached: Story = {}
