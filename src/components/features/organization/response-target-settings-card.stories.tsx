// Response target settings — two whole-hour forms over one update action.
// The Cleared story is the contract: a cleared control must render the
// schema's message and never put NaN on the input (React logs that as a
// console error, which the story gate turns into a failure). Out-of-range
// numbers never reach the schema: the input's min/max let the browser's own
// constraint validation stop the submit.
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
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
        },
        privateFeedbackHandling: {
          targetKind: 'private_feedback_handling',
          durationMinutes: 36 * 60,
          policySource: 'organization_policy',
          policyVersion: 1,
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
