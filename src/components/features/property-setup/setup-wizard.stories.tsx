import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { SetupWizard } from './setup-wizard'
import type { SetupWizardStepId } from './setup-wizard-steps'

const meta = {
  title: 'PropertySetup/SetupWizard',
  component: SetupWizard,
  parameters: { layout: 'padded' },
  args: {
    step: 'confirm',
    children: <p>Confirm-details table</p>,
  },
} satisfies Meta<typeof SetupWizard>

export default meta
type Story = StoryObj<typeof meta>

export const ConfirmDetails: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: /import steps/i })
    const current = within(steps).getAllByRole('listitem')[2]!
    await expect(current).toHaveAttribute('aria-current', 'step')
    await expect(current).toHaveTextContent('Confirm details')
    await expect(within(steps).getAllByRole('listitem')).toHaveLength(5)
    await expect(within(steps).queryByRole('button')).not.toBeInTheDocument()
    await expect(canvas.getByText('Confirm-details table')).toBeVisible()
    await expect(
      within(steps).getByText('Confirm details').getBoundingClientRect().width,
    ).toBeGreaterThan(1)
    await expect(canvas.getByText('Step 3 of 5: Confirm details')).not.toBeVisible()
  },
}

export const SetUpProperties: Story = {
  args: { step: 'setup', children: <p>Setup questions</p> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: /import steps/i })
    await expect(within(steps).getAllByRole('listitem')[4]).toHaveAttribute(
      'aria-current',
      'step',
    )
    await expect(steps.querySelectorAll('svg')).toHaveLength(4)
  },
}

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: /import steps/i })
    await expect(within(steps).getAllByRole('listitem')[2]).toHaveAttribute(
      'aria-current',
      'step',
    )
    const title = within(steps).getByText('Confirm details')
    const caption = canvas.getByText('Step 3 of 5: Confirm details')
    await expect(window.matchMedia('(min-width: 64rem)').matches).toBe(false)
    await expect(title.getBoundingClientRect().width).toBeLessThanOrEqual(1)
    await expect(
      within(steps).getByText('Check each property').getBoundingClientRect().width,
    ).toBeLessThanOrEqual(1)
    await expect(caption).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

function PropertyQuestions({
  onContinue,
  onBack,
}: Readonly<{
  onContinue: () => void
  onBack: () => void
}>) {
  const [name, setName] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Property name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button onClick={onContinue}>Continue</Button>
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
    </div>
  )
}

function WizardInteraction() {
  const [step, setStep] = useState<SetupWizardStepId>('confirm')
  return (
    <SetupWizard step={step}>
      <PropertyQuestions
        onContinue={() => setStep('setup')}
        onBack={() => setStep('confirm')}
      />
    </SetupWizard>
  )
}

export const KeepsScreenState: Story = {
  render: () => <WizardInteraction />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Property name' })
    await userEvent.type(name, 'Seaside hotel')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    let steps = canvas.getByRole('list', { name: /import steps/i })
    await expect(within(steps).getAllByRole('listitem')[4]).toHaveAttribute(
      'aria-current',
      'step',
    )
    await expect(name).toHaveValue('Seaside hotel')
    await expect(name).toBe(canvas.getByRole('textbox', { name: 'Property name' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    steps = canvas.getByRole('list', { name: /import steps/i })
    await expect(within(steps).getAllByRole('listitem')[2]).toHaveAttribute(
      'aria-current',
      'step',
    )
    await expect(canvas.getByRole('textbox', { name: 'Property name' })).toHaveValue(
      'Seaside hotel',
    )
  },
}
