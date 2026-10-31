import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { OrganizationAiOverviewPage } from './organization-ai-overview-page'

const meta = {
  title: 'Settings/OrganizationAiOverviewPage',
  component: OrganizationAiOverviewPage,
  decorators: [withRole('AccountAdmin')],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OrganizationAiOverviewPage>

export default meta
type Story = StoryObj<typeof meta>

const HARBORLINE = '10000000-0000-4000-8000-000000000101'
const PINE = '10000000-0000-4000-8000-000000000102'
const CAFE = '10000000-0000-4000-8000-000000000103'

export const MixedOrganization: Story = {
  args: {
    overview: {
      properties: [
        {
          propertyId: HARBORLINE,
          propertyName: 'Harborline Suites',
          state: 'enabled',
          capabilities: ['review_analysis', 'reply_drafting'],
          noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
          reconsentRequired: true,
          decisionDeferredAt: null,
          googleBindingActive: true,
        },
        {
          propertyId: PINE,
          propertyName: 'Pine Lodge',
          state: 'disabled',
          capabilities: [],
          noticeVersion: null,
          reconsentRequired: false,
          decisionDeferredAt: '2026-09-15T08:00:00.000Z',
          googleBindingActive: true,
        },
        {
          propertyId: CAFE,
          propertyName: 'Harbor Café',
          state: 'disabled',
          capabilities: [],
          noticeVersion: null,
          reconsentRequired: false,
          decisionDeferredAt: null,
          googleBindingActive: false,
        },
      ],
    },
    spend: {
      monthStartEpochMillis: Date.parse('2026-09-01T00:00:00.000Z'),
      settledMicros: 3_420_000,
      reservedMicros: 60_000,
      capMicros: 50_000_000,
    },
    progressByProperty: new Map([
      [
        HARBORLINE,
        {
          status: 'analysing' as const,
          queued: 40,
          inProgress: 2,
          analysed: 54,
          notAnalysable: 0,
          verifiedThroughEpochMillis: null,
        },
      ],
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('0 of 3')).toBeVisible()
    expect(canvas.getByText('$3.42')).toBeVisible()
    expect(canvas.getByText('Paused — needs attention')).toBeVisible()
    expect(canvas.getByText('Not now')).toBeVisible()
    expect(canvas.getByText('Google not linked')).toBeVisible()
    expect(canvas.queryByText('54 analysed · 42 to go')).not.toBeInTheDocument()
    expect(canvas.getByRole('link', { name: /pine lodge/i })).toHaveAttribute(
      'href',
      `/properties/${PINE}/settings/ai`,
    )
  },
}

export const NoProperties: Story = {
  args: {
    overview: { properties: [] },
    spend: undefined,
    progressByProperty: new Map(),
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByText('No properties to manage AI for'),
    ).toBeVisible()
  },
}

export const AutomaticallyUpdated: Story = {
  args: {
    ...MixedOrganization.args,
    overview: {
      properties: [
        { ...MixedOrganization.args!.overview.properties[0]!, reconsentRequired: false },
      ],
      latestUpdate: {
        noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
        noticeDigest: 'a'.repeat(64),
        renewedAt: '2026-10-31T09:00:00Z',
        title: 'AI review insights got an upgrade',
        points: [
          'Past reviews are read again, so topics and counts can shift for a short while.',
        ],
      },
    },
  },
}
export const PausedAndOff: Story = {
  args: {
    ...MixedOrganization.args,
    overview: {
      properties: [
        {
          ...MixedOrganization.args!.overview.properties[0]!,
          pauseReason: 'google_unbound',
          googleBindingActive: false,
        },
        {
          ...MixedOrganization.args!.overview.properties[0]!,
          propertyId: PINE,
          propertyName: 'Pine Lodge',
          pauseReason: 'no_account_admin',
        },
        {
          ...MixedOrganization.args!.overview.properties[0]!,
          propertyId: CAFE,
          propertyName: 'Harbor Café',
          state: 'revoked',
          capabilities: [],
          reconsentRequired: false,
        },
      ],
    },
  },
}
