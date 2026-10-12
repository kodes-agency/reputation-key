// ConsentCheckbox: the one frame for a statement the person agrees to or confirms.
// Dark is the default theme; the light variants render the same on the light surface
// (axe runs on both). The Storybook Vitest project compiles no Tailwind, so the plays
// pin behaviour and wiring (the sentence names the box, the help and the refusal are
// the box's description, a missed box says why), not colours.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { ConsentCheckbox } from './consent-checkbox'

type Props = Readonly<{
  withHelp?: boolean
  attempted?: boolean
  disabled?: boolean
  startsChecked?: boolean
}>

function Consent({
  withHelp = true,
  attempted = false,
  disabled = false,
  startsChecked = false,
}: Props) {
  const [checked, setChecked] = useState(startsChecked)
  return (
    <div className="max-w-xl">
      <ConsentCheckbox
        id="story-consent"
        checked={checked}
        onCheckedChange={setChecked}
        disabled={disabled}
        description={
          withHelp
            ? 'Required to enable AI features. RepKey records who agreed and the notice version they read.'
            : undefined
        }
        error={
          attempted && !checked ? 'Confirm that you have read the notice.' : undefined
        }
      >
        I have read this notice and agree to this data use for Harborline Suites on behalf
        of my organization.
      </ConsentCheckbox>
    </div>
  )
}

const meta: Meta<typeof Consent> = {
  title: 'Patterns/Consent checkbox',
  component: Consent,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof Consent>

const SENTENCE = /I have read this notice and agree/

/** The sentence names the box and the help is its description; ticking it is one click on either. */
export const Anatomy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: SENTENCE })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'Required to enable AI features. RepKey records who agreed and the notice version they read.',
    )

    await userEvent.click(canvas.getByText(SENTENCE))
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(box).not.toBeChecked()
  },
}

export const AnatomyLight: Story = { ...Anatomy, parameters: { theme: 'light' } }

/** A box left empty after an attempt says why, as an alert that is part of its description. */
export const Refused: Story = {
  args: { attempted: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: SENTENCE })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(canvas.getByRole('alert')).toHaveTextContent(
      'Confirm that you have read the notice.',
    )
    expect(box).toHaveAccessibleDescription(/Confirm that you have read the notice\./)

    // Ticking it ends the refusal.
    await userEvent.click(box)
    expect(canvas.queryByRole('alert')).toBeNull()
    expect(box).not.toHaveAttribute('aria-invalid')
  },
}

export const RefusedLight: Story = { ...Refused, parameters: { theme: 'light' } }

/** A sentence with no help line draws none, and describes nothing. */
export const WithoutHelp: Story = {
  args: { withHelp: false },
  play: ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: SENTENCE })
    expect(box).not.toHaveAccessibleDescription()
  },
}

/** While the group saves the box waits. */
export const Disabled: Story = {
  args: { disabled: true, startsChecked: true },
  play: ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: SENTENCE })
    expect(box).toBeDisabled()
    expect(box).toBeChecked()
  },
}

export const DisabledLight: Story = { ...Disabled, parameters: { theme: 'light' } }
