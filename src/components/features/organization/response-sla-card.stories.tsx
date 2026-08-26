import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import type { Action } from '#/components/hooks/use-action'
import { ResponseSlaCard } from './response-sla-card'

type SlaInput = Readonly<{ data: Readonly<{ responseSlaHours: number }> }>

const updateSla: Action<SlaInput, { responseSlaHours: number }> = Object.assign(
  async ({ data }: SlaInput) => data,
  { isPending: false, error: null, isSuccess: false, data: null },
)

function ServerRefreshHarness() {
  const [responseSlaHours, setResponseSlaHours] = useState(24)
  return (
    <div className="space-y-4">
      <Button onClick={() => setResponseSlaHours(48)}>Simulate server refresh</Button>
      <ResponseSlaCard
        key={responseSlaHours}
        responseSlaHours={responseSlaHours}
        updateSla={updateSla}
      />
    </div>
  )
}

const meta = {
  title: 'Organization/ResponseSlaCard',
  component: ResponseSlaCard,
  args: { responseSlaHours: 24, updateSla },
} satisfies Meta<typeof ResponseSlaCard>

export default meta
type Story = StoryObj<typeof meta>

export const ServerRefreshReplacesStaleDraft: Story = {
  render: () => <ServerRefreshHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hours = canvas.getByRole('spinbutton', { name: 'Hours' })
    await userEvent.clear(hours)
    await userEvent.type(hours, '36')
    await userEvent.click(canvas.getByRole('button', { name: 'Simulate server refresh' }))
    await expect(canvas.getByRole('spinbutton', { name: 'Hours' })).toHaveValue(48)
  },
}
