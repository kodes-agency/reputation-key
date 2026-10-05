// The Property's private-feedback target: use the Organization's, or save its own.
// Dark is the default theme; the light variant renders the same card on the light
// surface (axe runs on both).
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { propertyId } from '#/shared/domain/ids'
import { PrivateFeedbackTargetCard } from './private-feedback-target-card'

type Update = ComponentProps<typeof PrivateFeedbackTargetCard>['updatePolicy']

const updatePolicySpy = fn(async () => undefined)
const updatePolicy = Object.assign(updatePolicySpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as Update

const settings = {
  organization: {
    googleReviewResponse: {
      targetKind: 'google_review_response',
      durationMinutes: 24 * 60,
      policySource: 'builtin_default',
      policyVersion: null,
      lowRating: null,
    },
    privateFeedbackHandling: {
      targetKind: 'private_feedback_handling',
      durationMinutes: 36 * 60,
      policySource: 'organization_policy',
      policyVersion: 1,
      lowRating: null,
    },
  },
  privateFeedbackPropertyOverride: {
    propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
    durationMinutes: 48 * 60,
    policyVersion: 2,
    effectiveDurationMinutes: 48 * 60,
    effectiveSource: 'property_override',
  },
} as unknown as ComponentProps<typeof PrivateFeedbackTargetCard>['settings']

/** Stands in for the utilities layer, which this runner does not compile: the link to the Organization target stays underlined (axe link-in-text-block). */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

const meta: Meta<typeof PrivateFeedbackTargetCard> = {
  title: 'Property/PrivateFeedbackTargetCard',
  component: PrivateFeedbackTargetCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { settings, updatePolicy },
  decorators: [
    (Story) => (
      <>
        <style>{UTILITY_LAYER}</style>
        <Story />
      </>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PrivateFeedbackTargetCard>

/** The save is in the card's footer, right-aligned with the primary last. */
export const Saved: Story = {
  play: async ({ canvasElement }) => {
    updatePolicySpy.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()
    const hours = canvas.getByLabelText('Property hours')
    expect(hours).toHaveValue(48)

    await userEvent.clear(hours)
    await userEvent.type(hours, '24')
    await userEvent.click(canvas.getByRole('button', { name: 'Save Property target' }))

    await waitFor(() => expect(updatePolicySpy).toHaveBeenCalledOnce())
    const save = canvas.getByRole('button', { name: 'Save Property target' })
    expect(save.closest('[data-slot="card-footer"]')).not.toBeNull()
  },
}

export const SavedLight: Story = { ...Saved, parameters: { theme: 'light' } }

/** Reset puts the saved hours back, and the primary waits for the next edit. */
export const ResetRestoresTheSavedHours: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hours = canvas.getByLabelText('Property hours')
    await userEvent.clear(hours)
    await userEvent.type(hours, '12')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(hours).toHaveValue(48)
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
  },
}

/**
 * The row says the Property has a target of its own and what it replaced; going back to the
 * Organization target is a change the group's Save sends (a null duration), and Reset takes it back.
 */
export const FollowsTheOrganizationTarget: Story = {
  play: async ({ canvasElement }) => {
    updatePolicySpy.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Set here instead of/)).toHaveTextContent(
      'Set here instead of the Organization target (36 hours).',
    )
    expect(canvas.getByRole('link', { name: 'the Organization target' })).toHaveAttribute(
      'href',
      '/settings/organization',
    )
    const hours = canvas.getByLabelText('Property hours')
    expect(hours).toBeEnabled()

    await userEvent.click(canvas.getByRole('button', { name: 'Use Organization target' }))
    expect(canvas.getByText(/Follows/)).toHaveTextContent(
      'Follows the Organization target, currently 36 hours.',
    )
    expect(hours).toBeDisabled()
    expect(
      canvas.getByText('This remains linked to future Organization changes.'),
    ).toBeVisible()

    // Reset puts the saved override back.
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(canvas.getByText(/Set here instead of/)).toBeVisible()
    expect(canvas.getByLabelText('Property hours')).toBeEnabled()

    await userEvent.click(canvas.getByRole('button', { name: 'Use Organization target' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save Property target' }))
    await waitFor(() => expect(updatePolicySpy).toHaveBeenCalledOnce())
    expect(updatePolicySpy).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'property', durationMinutes: null }),
    })
  },
}

export const FollowsTheOrganizationTargetLight: Story = {
  ...FollowsTheOrganizationTarget,
  parameters: { theme: 'light' },
}
