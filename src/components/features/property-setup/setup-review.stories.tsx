// The "Review and save" step's consent ceremony (merchant-ai-notice-2026-10-17.v1).
// The button reads "Enable AI features" for one property or many; the
// acknowledgement names every property, as a list under its sentence when there
// are several. The Storybook Vitest project compiles no Tailwind, so the plays pin
// names and wiring; the wrapping of long names and the two-column list are for the
// eye in Storybook proper, at 320 px and up.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { PropertySetupPlan } from './setup-plan'
import { SetupReview } from './setup-review'

const LONG_NAME =
  'Harbour and Pine Riverside Apartments with Garden Courtyard and Rooftop Terrace'
const UNBROKEN_NAME = `Property${'Name'.repeat(16)}`

function entry(index: number, propertyName: string): PropertySetupPlan {
  return {
    propertyId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    propertyName,
    displayName: propertyName,
    language: 'en-Latn',
    managerIds: null,
    ai: 'enable',
  }
}

const TWENTY_FOUR = [
  LONG_NAME,
  UNBROKEN_NAME,
  ...Array.from({ length: 22 }, (_, index) => `Sample Property ${index + 3}`),
].map((name, index) => entry(index, name))

function Review({ properties }: Readonly<{ properties: readonly PropertySetupPlan[] }>) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <SetupReview
      plan={{
        properties,
        aiCapabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
      }}
      facts={[]}
      members={new Map()}
      notice={MERCHANT_AI_NOTICE}
      acknowledged={acknowledged}
      onAcknowledgedChange={setAcknowledged}
      saving={false}
      onBack={() => undefined}
      onSave={() => undefined}
    />
  )
}

const meta = {
  title: 'PropertySetup/SetupReview',
  component: Review,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Review>

export default meta
type Story = StoryObj<typeof meta>

/** One property: the acknowledgement names it in its sentence. */
export const OnePropertyConsent: Story = {
  args: { properties: [entry(0, LONG_NAME)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cta = canvas.getByRole('button', { name: 'Enable AI features' })
    await expect(cta).toBeDisabled()
    await userEvent.click(
      canvas.getByRole('checkbox', {
        name: `I have read this notice and agree to this data use for ${LONG_NAME} on behalf of my organization.`,
      }),
    )
    await expect(cta).toBeEnabled()
  },
}

/** Twenty-four properties: the button stays one short line, the list names them all. */
export const TwentyFourPropertiesConsent: Story = {
  args: { properties: TWENTY_FOUR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const acknowledgement = canvas.getByRole('checkbox', {
      name: 'I have read this notice and agree to this data use on behalf of my organization for these 24 properties:',
    })
    const names = TWENTY_FOUR.map(({ propertyName }) => propertyName)
    // The names are the box's description, one comma between each, read ahead
    // of its line of help; browsing reads the drawn list as a list.
    await expect(acknowledgement).toHaveAccessibleDescription(
      `${names.join(', ')}. Required to enable AI features. RepKey records who agreed and the notice version they read.`,
    )
    const listed = within(
      canvasElement.querySelector<HTMLElement>('[data-slot="consent-checkbox-list"]')!,
    )
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    await expect(listed).toEqual(names)
    const cta = canvas.getByRole('button', { name: 'Enable AI features' })
    await userEvent.click(acknowledgement)
    await expect(cta).toBeEnabled()
  },
}
