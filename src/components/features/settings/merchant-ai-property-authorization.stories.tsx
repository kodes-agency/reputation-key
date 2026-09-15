// One property's AI authorization, as the property's AI settings section
// renders it: consent against the served notice, then enable, change or turn
// off. The property is fixed by the caller, so there is no selector, and reply
// language is set in the Replies section rather than beside the consent.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { MerchantAiSnapshot } from '#/contexts/identity/application/public-api'
import {
  AI_CONSENT_ACKNOWLEDGEMENT,
  consentToAi,
} from './merchant-ai-consent.stories.play'
import { MerchantAiPropertyAuthorization } from './merchant-ai-property-authorization'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const property = {
  id: PROPERTY_ID,
  name: 'Harbor & Pine — A very long property name for narrow screens',
  googleBindingState: 'active' as const,
}

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
    acknowledgement: { noticeVersion: string; noticeDigest: string }
    capabilities: Array<'review_analysis' | 'reply_drafting' | 'property_trends'>
  }
}

const SERVED_NOTICE = {
  noticeVersion: MERCHANT_AI_NOTICE.version,
  noticeDigest: MERCHANT_AI_NOTICE.digest,
}
// Anchored: the trends description itself mentions review analysis.
const CAPABILITY_LABELS = [/^review analysis/i, /^reply drafting/i, /^property trends/i]
// What the server says when the notice changed between reading and consenting.
const NOTICE_CHANGED =
  'The AI data-use notice changed. Reload it, review it, and confirm again.'

const enableAction = fn(async (_input: { data: { acknowledgement: unknown } }) => enabled)
const refusedEnableAction = fn(
  async (_input: { data: { acknowledgement: unknown } }): Promise<MerchantAiSnapshot> => {
    throw new Error(NOTICE_CHANGED)
  },
)
const changeAction = fn(async (input: ChangeActionInput) => ({
  ...enabled,
  capabilities: input.data.capabilities,
  stateVersion: enabled.stateVersion + 1,
}))
const revokeAction = fn(async (_input: { data: Record<string, unknown> }) => ({
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
const changedAction = fn((_snapshot: MerchantAiSnapshot) => undefined)

const meta = {
  title: 'Settings/MerchantAiPropertyAuthorization',
  component: MerchantAiPropertyAuthorization,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    AuthedRouterDecorator,
    (Story) => (
      <div className="max-w-4xl p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    property,
    notice: MERCHANT_AI_NOTICE,
    enable: enableAction,
    change: changeAction,
    revoke: revokeAction,
    onChanged: changedAction,
  },
} satisfies Meta<typeof MerchantAiPropertyAuthorization>

export default meta
type Story = StoryObj<typeof meta>

export const AwaitingConsent: Story = {
  args: { snapshot: disabled },
  play: async ({ canvasElement }) => {
    enableAction.mockClear()
    changedAction.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText(/password/i)).not.toBeInTheDocument()
    await expect(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    ).toHaveAccessibleName(
      `I have read this notice and agree to this data use for ${property.name} on behalf of my organization.`,
    )
    await consentToAi(canvasElement)
    await waitFor(() => expect(enableAction).toHaveBeenCalledOnce())
    // Consent names the notice that was on screen, not a password.
    expect(enableAction.mock.calls[0]?.[0].data.acknowledgement).toEqual(SERVED_NOTICE)
    expect(await canvas.findByText('On')).toBeInTheDocument()
    // The surrounding section hears about the accepted command and refreshes.
    expect(changedAction).toHaveBeenCalledWith(enabled)
    // The next consent is acknowledged afresh.
    expect(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    ).not.toBeChecked()
  },
}

// A refused consent says why, leaves AI off and asks for the acknowledgement
// again; nothing tells the surrounding section that anything changed.
export const ConsentRefused: Story = {
  args: { snapshot: disabled, enable: refusedEnableAction },
  play: async ({ canvasElement }) => {
    refusedEnableAction.mockClear()
    changedAction.mockClear()
    const canvas = within(canvasElement)
    await consentToAi(canvasElement)
    await waitFor(() => expect(refusedEnableAction).toHaveBeenCalledOnce())
    expect(await canvas.findByText(NOTICE_CHANGED)).toBeVisible()
    expect(canvas.getByText('Off')).toBeInTheDocument()
    expect(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    ).not.toBeChecked()
    expect(canvas.getByRole('button', { name: /^enable ai features$/i })).toBeDisabled()
    expect(changedAction).not.toHaveBeenCalled()
  },
}

export const EnabledSelectiveControls: Story = {
  args: { snapshot: enabled },
  play: async ({ canvasElement }) => {
    changeAction.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText(/property trends/i))
    const save = canvas.getByRole('button', { name: /save feature access/i })
    await expect(save).toBeDisabled()
    await userEvent.click(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    )
    await userEvent.click(save)
    await waitFor(() => expect(changeAction).toHaveBeenCalledOnce())
    expect(changeAction.mock.calls[0]?.[0].data).toMatchObject({
      capabilities: ['review_analysis', 'reply_drafting'],
      acknowledgement: SERVED_NOTICE,
    })
  },
}

// A re-versioned consent notice must be submittable WITHOUT touching the
// capability set. Before this was fixed the Save button stayed disabled here, and
// the only way to re-consent was to drop a capability and re-add it — which
// briefly revoked it, wrote an extra evidence row and bumped that capability's
// epoch twice. The snapshot below is the shape a merchant is in the moment a new
// notice ships: identical capabilities, stale notice version and digest.
export const ReconsentAfterNoticeReversion: Story = {
  args: {
    snapshot: {
      ...enabled,
      noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
      noticeDigest: 'a'.repeat(64),
    },
  },
  play: async ({ canvasElement }) => {
    changeAction.mockClear()
    const canvas = within(canvasElement)
    for (const label of CAPABILITY_LABELS) {
      expect(canvas.getByRole('checkbox', { name: label })).toBeChecked()
    }
    await userEvent.click(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    )
    const save = canvas.getByRole('button', { name: /save feature access/i })
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() => expect(changeAction).toHaveBeenCalledOnce())
    // Re-consent re-affirms the same set; nothing is dropped on the way through.
    expect(changeAction.mock.calls[0]?.[0].data.capabilities).toEqual([
      'review_analysis',
      'reply_drafting',
      'property_trends',
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
    for (const label of CAPABILITY_LABELS) {
      expect(canvas.getByRole('checkbox', { name: label })).toBeChecked()
    }
    expect(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    ).not.toBeChecked()
  },
}

// Withdrawing consent needs no acknowledgement; only granting it does.
export const TurnOffWithoutAcknowledgement: Story = {
  args: { snapshot: enabled },
  play: async ({ canvasElement }) => {
    revokeAction.mockClear()
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
    ).not.toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: /turn off ai features/i }))
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: /^turn off$/i }))
    await waitFor(() => expect(revokeAction).toHaveBeenCalledOnce())
    expect(revokeAction.mock.calls[0]?.[0]).toEqual({
      data: expect.not.objectContaining({ acknowledgement: expect.anything() }),
    })
  },
}

export const GoogleSourceUnavailableForPropertyManager: Story = {
  args: {
    property: { ...property, googleBindingState: 'disconnected' },
    snapshot: enabled,
  },
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        /ask an account admin to connect Google and confirm this property's Business Profile/i,
      ),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('link', { name: /open Google integrations/i }),
    ).toBeNull()
    await expect(
      canvas.queryByRole('link', { name: /review property import/i }),
    ).toBeNull()
  },
}

export const GoogleSourceUnavailableForAccountAdmin: Story = {
  args: {
    property: { ...property, googleBindingState: 'disconnected' },
    snapshot: enabled,
  },
  decorators: [withRole('AccountAdmin')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const integrations = canvas.getByRole('link', { name: /open Google integrations/i })
    const propertyImport = canvas.getByRole('link', { name: /review property import/i })
    await expect(integrations).toBeVisible()
    await expect(integrations).toHaveAttribute('href', '/settings/integrations')
    await expect(propertyImport).toBeVisible()
    await expect(propertyImport).toHaveAttribute('href', '/properties/import-google')

    integrations.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    })
    await userEvent.click(integrations)
  },
}
