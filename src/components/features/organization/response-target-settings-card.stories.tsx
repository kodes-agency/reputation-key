// Response target settings — two whole-hour forms over one update action.
// The Cleared story is the contract: a cleared control must render the
// schema's message and never put NaN on the input (React logs that as a
// console error, which the story gate turns into a failure). Out-of-range
// numbers never reach the schema: the input's min/max let the browser's own
// constraint validation stop the submit.
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import { propertyId } from '#/shared/domain/ids'
import { ResponseTargetSettingsCard } from './response-target-settings-card'

const updatePolicy = Object.assign(
  fn(async () => undefined),
  {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  },
) as unknown as ComponentProps<typeof ResponseTargetSettingsCard>['updatePolicy']

const meta: Meta<typeof ResponseTargetSettingsCard> = {
  title: 'Organization/Response Target Settings',
  component: ResponseTargetSettingsCard,
  tags: ['autodocs'],
  args: {
    settings: {
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
        durationMinutes: null,
        policyVersion: null,
        effectiveDurationMinutes: 36 * 60,
        effectiveSource: 'organization_policy',
      },
    },
    googleReviewAnalytics: {
      targetKind: 'google_review_response',
      measuredCycleCount: 12,
      activeCount: 2,
      currentOverdueCount: 1,
      respondedOnTimeCount: 8,
      respondedLateCount: 1,
      reopenCount: 0,
      historicalOnboardingExcludedCount: 3,
      legacyUnknownExcludedCount: 0,
      averageTimeToResponseMinutes: 400,
    },
    privateFeedbackAnalytics: {
      targetKind: 'private_feedback_handling',
      measuredCycleCount: 5,
      activeCount: 1,
      currentOverdueCount: 0,
      handledOnTimeCount: 4,
      handledLateCount: 0,
      reopenCount: 0,
      averageTimeToFirstHandlingMinutes: 90,
    },
    updatePolicy,
  },
}
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Cleared: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hours = canvas.getByLabelText('Hours', {
      selector: '#private_feedback_handling-hours',
    })
    await userEvent.clear(hours)
    await userEvent.click(canvas.getAllByRole('button', { name: 'Save target' })[1]!)
    await expect(
      await canvas.findByText('Enter the target in whole hours'),
    ).toBeInTheDocument()
    await expect(hours).toHaveAttribute('aria-invalid', 'true')
    await expect(updatePolicy).not.toHaveBeenCalled()
  },
}

// Each target is a group of its own: Reset puts that group's saved hours back and
// leaves the other group as it is.
export const ResetRestoresTheSavedHours: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()
    const google = canvas.getByLabelText('Hours', {
      selector: '#google_review_response-hours',
    })
    const feedback = canvas.getByLabelText('Hours', {
      selector: '#private_feedback_handling-hours',
    })
    await userEvent.clear(feedback)
    await userEvent.type(feedback, '48')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    await expect(feedback).toHaveValue(36)
    await expect(google).toHaveValue(24)
    // The actions end the group's panel, with the primary last.
    const save = canvas.getAllByRole('button', { name: 'Save target' })[1]!
    expect(save.closest('form')).toContainElement(feedback)
  },
}

// "Answer low-rated reviews sooner" is one switch of the Google group (it saves with
// the group's Save), and the rating it names is the shared rating-threshold select,
// worded "3★ or lower", not a number box.
export const LowRatingTargetIsASwitchAndARatingSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    mocked(updatePolicy).mockClear()
    const sooner = canvas.getByRole('switch', { name: 'Answer low-rated reviews sooner' })
    expect(sooner).not.toBeChecked()
    expect(canvas.queryByRole('combobox', { name: 'Low rating' })).toBeNull()

    await userEvent.click(sooner)
    const rating = await canvas.findByRole('combobox', { name: 'Low rating' })
    expect(rating).toHaveTextContent('2 stars or lower')
    await userEvent.click(rating)
    await userEvent.click(
      await within(document.body).findByRole('option', { name: '3 stars or lower' }),
    )
    expect(rating).toHaveTextContent('3 stars or lower')

    await userEvent.click(canvas.getAllByRole('button', { name: 'Save target' })[0]!)
    await waitFor(() => expect(updatePolicy).toHaveBeenCalledOnce())
    expect(updatePolicy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'organization',
        targetKind: 'google_review_response',
        lowRating: { threshold: 3, durationMinutes: 240 },
      }),
    })
  },
}

export const LowRatingTargetIsASwitchAndARatingSelectLight: Story = {
  ...LowRatingTargetIsASwitchAndARatingSelect,
  parameters: { theme: 'light' },
}
