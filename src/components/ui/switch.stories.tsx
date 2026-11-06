import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { checkPhoneWidths } from '#/shared/testing/phone-width'
import { Label } from './label'
import { Switch } from './switch'

function Switches() {
  const [checked, setChecked] = useState(false)
  return (
    <div className="flex max-w-sm flex-col gap-4 p-6">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="switch-default">Notifications</Label>
        <Switch id="switch-default" checked={checked} onCheckedChange={setChecked} />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="switch-small">Quiet hours</Label>
        <Switch id="switch-small" size="sm" />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="switch-disabled">Always on</Label>
        <Switch id="switch-disabled" checked disabled />
      </div>
    </div>
  )
}

const meta = {
  title: 'UI/Switch',
  component: Switches,
} satisfies Meta<typeof Switches>

export default meta
type Story = StoryObj<typeof meta>

export const Targets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notifications = canvas.getByRole('switch', { name: 'Notifications' })
    await userEvent.click(notifications)
    expect(notifications).toBeChecked()
    await userEvent.keyboard(' ')
    expect(notifications).not.toBeChecked()
    expect(canvas.getByRole('switch', { name: 'Always on' })).toBeDisabled()
    expect(canvas.getByRole('switch', { name: 'Always on' })).toBeChecked()

    const doc = canvasElement.ownerDocument
    await checkPhoneWidths(doc)
    for (const control of canvas.getAllByRole('switch')) {
      if (control.hasAttribute('disabled')) continue
      const rect = control.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      for (const dx of [-21, 21]) {
        for (const dy of [-21, 21]) {
          const hit = doc.elementFromPoint(x + dx, y + dy)
          expect(hit === control || (hit !== null && control.contains(hit))).toBe(true)
        }
      }
    }
  },
}
