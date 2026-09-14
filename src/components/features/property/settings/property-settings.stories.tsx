import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../../.storybook/AuthedRouterDecorator'
import { PropertyGoogleSection } from './property-google-section'
import { PropertyProfileCard } from './property-profile-card'
import { PropertySettingsNav } from './property-settings-nav'
import { visiblePropertySettingsSections } from './property-settings-sections'
import { ReviewAnalysisProgressCard } from './review-analysis-progress-card'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'

type ProfileAction = ComponentProps<typeof PropertyProfileCard>['updateProperty']
const saveProfileSpy = fn(async (_input: Parameters<ProfileAction>[0]) => undefined)
const saveProfile = Object.assign(saveProfileSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as ProfileAction

const property = {
  id: PROPERTY_ID,
  name: 'Harborline Suites',
  countryCode: 'BG',
  timezone: 'Europe/Sofia',
  address: '1 Seaside Boulevard, Varna',
}

const meta = {
  title: 'Property/Settings hub',
  decorators: [withRole('AccountAdmin')],
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SectionNavigation: Story = {
  render: () => (
    <div className="max-w-xs">
      <PropertySettingsNav
        propertyId={PROPERTY_ID}
        sections={visiblePropertySettingsSections(() => true)}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Property settings sections',
    })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.querySelector('span')?.textContent)
    expect(labels).toEqual([
      'Profile',
      'Google',
      'Replies',
      'AI',
      'People',
      'Targets',
      'Danger zone',
    ])
    expect(within(nav).getByRole('link', { name: /^AI/ })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/settings/ai`,
    )
  },
}

export const EditableProfile: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PropertyProfileCard property={property} canEdit updateProperty={saveProfile} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    saveProfileSpy.mockClear()
    const canvas = within(canvasElement)
    const name = canvas.getByLabelText('Workspace name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Harborline Suites Varna')
    expect(canvas.getByText('1 Seaside Boulevard, Varna')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Save profile' }))

    await waitFor(() =>
      expect(saveProfileSpy).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          name: 'Harborline Suites Varna',
          countryCode: 'BG',
          timezone: 'Europe/Sofia',
        },
      }),
    )
  },
}

export const ReadOnlyProfile: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PropertyProfileCard
        property={property}
        canEdit={false}
        updateProperty={saveProfile}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByLabelText('Workspace name')).toBeDisabled()
    expect(canvas.queryByRole('button', { name: 'Save profile' })).toBeNull()
  },
}

export const GoogleLinked: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PropertyGoogleSection
        property={{
          id: PROPERTY_ID,
          googleBindingState: 'active',
          googleReviewDestination: { state: 'verified', retrievedAt: null },
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Linked')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Disconnect…' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/settings/danger`,
    )
  },
}

export const GoogleDisconnected: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PropertyGoogleSection
        property={{ id: PROPERTY_ID, googleBindingState: 'disconnected' }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Disconnected')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Link with Google import' })).toBeVisible()
    expect(canvas.queryByRole('link', { name: 'Disconnect…' })).toBeNull()
  },
}

export const AnalysisRunning: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ReviewAnalysisProgressCard
        progress={{
          status: 'analysing',
          queued: 58,
          inProgress: 2,
          analysed: 30,
          notAnalysable: 6,
          verifiedThroughEpochMillis: null,
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Analysing')).toBeVisible()
    expect(canvas.getByRole('progressbar', { name: 'Reviews analysed' })).toHaveAttribute(
      'aria-valuenow',
      '38',
    )
  },
}

export const AnalysisCaughtUp: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ReviewAnalysisProgressCard
        progress={{
          status: 'caught_up',
          queued: 0,
          inProgress: 0,
          analysed: 96,
          notAnalysable: 4,
          verifiedThroughEpochMillis: Date.parse('2026-09-15T09:30:00.000Z'),
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Up to date')).toBeVisible()
  },
}
