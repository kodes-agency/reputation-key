import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { MerchantAiSnapshot } from '#/contexts/identity/application/public-api'
import { MerchantAiSettingsPage } from './merchant-ai-settings-page'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const properties = [
  {
    id: PROPERTY_ID,
    name: 'Harbor & Pine — A very long property name for narrow screens',
    googleBindingState: 'active' as const,
  },
]

const disabled: MerchantAiSnapshot = {
  organizationId: 'org-story',
  propertyId: PROPERTY_ID,
  state: 'disabled',
  authorizationLineageId: null,
  capabilities: [],
  capabilityRuntimeProfileVersions: {},
  capabilityEpochs: {
    review_analysis: 0,
    reply_drafting: 0,
    property_trends: 0,
  },
  authorizedSourceEpoch: 0,
  analysisStartSequence: 0,
  stateVersion: 0,
  noticeVersion: MERCHANT_AI_NOTICE.version,
  noticeDigest: MERCHANT_AI_NOTICE.digest,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  processingRegion: 'global',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'gbp-review-global-v1',
}

const enabled: MerchantAiSnapshot = {
  ...disabled,
  state: 'enabled',
  authorizationLineageId: '20000000-0000-4000-8000-000000000001',
  capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
  capabilityRuntimeProfileVersions: {
    review_analysis: 'review-analysis-runtime-v1',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  },
  capabilityEpochs: {
    review_analysis: 1,
    reply_drafting: 1,
    property_trends: 1,
  },
  authorizedSourceEpoch: 7,
  analysisStartSequence: 0,
  stateVersion: 1,
}

type ChangeActionInput = {
  data: {
    propertyId: string
    expectedStateVersion: number
    idempotencyKey: string
    password: string
    capabilities: Array<'review_analysis' | 'reply_drafting' | 'property_trends'>
  }
}

const noOpPropertyChange = fn()
const enableAction = fn(async () => enabled)
const changeAction = fn(async (input: ChangeActionInput) => ({
  ...enabled,
  capabilities: input.data.capabilities,
  stateVersion: enabled.stateVersion + 1,
}))
const revokeAction = fn(async () => ({
  ...enabled,
  state: 'revoked' as const,
  capabilities: [],
  capabilityRuntimeProfileVersions: {},
  capabilityEpochs: {
    review_analysis: enabled.capabilityEpochs.review_analysis + 1,
    reply_drafting: enabled.capabilityEpochs.reply_drafting + 1,
    property_trends: enabled.capabilityEpochs.property_trends + 1,
  },
  stateVersion: enabled.stateVersion + 1,
}))

const meta = {
  title: 'Settings/MerchantAiSettingsPage',
  component: MerchantAiSettingsPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    properties,
    propertyId: PROPERTY_ID,
    notice: MERCHANT_AI_NOTICE,
    onPropertyChange: noOpPropertyChange,
    enable: enableAction,
    change: changeAction,
    revoke: revokeAction,
  },
} satisfies Meta<typeof MerchantAiSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const AwaitingConsent: Story = {
  args: { snapshot: disabled },
  play: async ({ canvasElement }) => {
    enableAction.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByLabelText(/confirm with your password/i),
      'correct-password',
    )
    await userEvent.click(canvas.getByRole('button', { name: /^enable ai features$/i }))
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: /confirm and enable/i }))
    await waitFor(() => expect(enableAction).toHaveBeenCalledOnce())
    expect(await canvas.findByText('On')).toBeInTheDocument()
    expect(canvas.getByLabelText(/confirm with your password/i)).toHaveValue('')
  },
}

export const EnabledSelectiveControls: Story = {
  args: { snapshot: enabled },
  play: async ({ canvasElement }) => {
    changeAction.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText(/property trends/i))
    await userEvent.type(
      canvas.getByLabelText(/confirm with your password/i),

      'correct-password',
    )
    await userEvent.click(canvas.getByRole('button', { name: /save feature access/i }))
    await waitFor(() => expect(changeAction).toHaveBeenCalledOnce())
    expect(changeAction.mock.calls[0]?.[0].data.capabilities).toEqual([
      'review_analysis',
      'reply_drafting',
    ])
  },
}

export const Revoked: Story = {
  args: {
    snapshot: {
      ...enabled,
      state: 'revoked',
      capabilities: [],
      capabilityRuntimeProfileVersions: {},
      capabilityEpochs: {
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      },
      stateVersion: 2,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: /enable ai features/i }),
    ).toBeInTheDocument()
    expect(
      canvas.queryByRole('button', { name: /turn off ai features/i }),
    ).not.toBeInTheDocument()
    for (const checkbox of canvas.getAllByRole('checkbox')) {
      expect(checkbox).toBeChecked()
    }
  },
}

export const GoogleSourceUnavailable: Story = {
  args: {
    properties: [{ ...properties[0], googleBindingState: 'disconnected' }],
    snapshot: enabled,
  },
}

export const NoPropertySelected: Story = {
  args: { propertyId: undefined, snapshot: null },
}
