import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Input } from './input'
import { Label } from './label'
import { Textarea } from './textarea'
import { Switch } from './switch'
import { Checkbox } from './checkbox'

const meta: Meta = {
  title: 'UI/Form Controls',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta

// Composite showcase of all controls in context.
export const Showcase: StoryObj<{ disabled?: boolean }> = {
  render: ({ disabled }) => (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Property name</Label>
        <Input id="name" placeholder="Acme Hotel" disabled={disabled} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="desc">Description</Label>
        <Textarea
          id="desc"
          placeholder="Tell guests about your property"
          disabled={disabled}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="active" defaultChecked disabled={disabled} />
        <Label htmlFor="active">Active</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="terms" defaultChecked disabled={disabled} />
        <Label htmlFor="terms">Accept terms</Label>
      </div>
    </div>
  ),
  args: { disabled: false },
}

// Per-control stories — typed StoryObj per real control so Args infer real props.
type InputStory = StoryObj<typeof Input>
type SwitchStory = StoryObj<typeof Switch>
type CheckboxStory = StoryObj<typeof Checkbox>

// --- Input ---
export const InputDefault: InputStory = {
  render: (args) => <Input {...args} />,
  args: { placeholder: 'Acme Hotel' },
}

export const InputDisabled: InputStory = {
  render: (args) => <Input {...args} />,
  args: { placeholder: 'Acme Hotel', disabled: true },
}

export const InputInvalid: InputStory = {
  render: (args) => <Input {...args} />,
  args: { placeholder: 'Acme Hotel', 'aria-invalid': true },
}

// --- Switch ---
export const SwitchDefault: SwitchStory = {
  render: (args) => <Switch {...args} aria-label="Active" />,
  args: { defaultChecked: true },
}

export const SwitchUnchecked: SwitchStory = {
  render: (args) => <Switch {...args} aria-label="Active" />,
  args: { defaultChecked: false },
}

export const SwitchControlled: SwitchStory = {
  render: (args) => <Switch {...args} aria-label="Active" />,
  args: { onCheckedChange: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('switch', { name: /active/i })
    await userEvent.click(toggle)
    await expect(toggle).toBeChecked()
  },
}

// --- Checkbox ---
export const CheckboxDefault: CheckboxStory = {
  render: (args) => <Checkbox {...args} aria-label="Accept terms" />,
  args: { defaultChecked: true },
}

export const CheckboxUnchecked: CheckboxStory = {
  render: (args) => <Checkbox {...args} aria-label="Accept terms" />,
  args: { defaultChecked: false },
}

export const CheckboxInvalid: CheckboxStory = {
  render: (args) => <Checkbox {...args} aria-label="Accept terms" />,
  args: { 'aria-invalid': true },
}
