import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../../.storybook/AuthedRouterDecorator'
import { PageHeader } from '#/components/layout/page-header'
import { PropertyGoogleSection } from './property-google-section'
import { PropertyProfileCard } from './property-profile-card'
import { PropertySettingsNav } from './property-settings-nav'
import {
  propertySettingsHeader,
  visiblePropertySettingsSections,
} from './property-settings-sections'
import { ReviewAnalysisProgressCard } from './review-analysis-progress-card'
import { PropertySetupStrip } from './property-setup-strip'
import type { PropertySetup } from '#/contexts/reporting/application/public-api'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

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

/**
 * The hub's sections, on Google: the router answers the address the nav reads, so
 * the one `aria-current` row is the current section and wears the accent-muted fill.
 */
export const SectionNavigation: Story = {
  decorators: [
    withRole('AccountAdmin', { at: `/properties/${PROPERTY_ID}/settings/google` }),
  ],
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
    const labelOf = (link: HTMLElement) =>
      link.querySelector('[data-slot="section-nav-label"]')?.textContent
    const links = within(nav).getAllByRole('link')
    expect(links.map(labelOf)).toEqual([
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
    // Exactly one row is the page the person is on, and it is Google.
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map(labelOf)).toEqual(['Google'])
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
    // Country and timezone read as names, never as codes or IANA ids.
    expect(canvas.getByRole('combobox', { name: 'Country' })).toHaveTextContent(
      'Bulgaria (BG)',
    )
    expect(canvas.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent(
      /^Sofia \(UTC\+[23]\)$/,
    )
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

const freshlyImported: PropertySetup = {
  propertyId: toPropertyId(PROPERTY_ID),
  attentionCount: 4,
  steps: [
    { key: 'google_linked', status: 'complete', asked: false, section: 'google' },
    { key: 'reviews_synced', status: 'waiting', asked: false, section: null },
    { key: 'reply_language', status: 'pending', asked: true, section: 'replies' },
    { key: 'ai_decision', status: 'pending', asked: true, section: 'ai' },
    { key: 'responsible_manager', status: 'pending', asked: true, section: 'people' },
    { key: 'reply_voice', status: 'complete', asked: false, section: 'replies' },
    { key: 'portal_published', status: 'pending', asked: false, section: 'portals' },
  ],
}

export const SetupStripAfterImport: Story = {
  render: () => <PropertySetupStrip propertyId={PROPERTY_ID} setup={freshlyImported} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('2 of 7 done')).toBeVisible()
    expect(canvas.getByText('Reviews are syncing')).toBeVisible()
    expect(
      canvas.getByRole('link', { name: /choose a reply language/i }),
    ).toHaveAttribute('href', `/properties/${PROPERTY_ID}/settings/replies`)
    expect(canvas.getByRole('link', { name: /publish a portal/i })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals`,
    )
  },
}

export const SetupStripForAPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  render: () => (
    <PropertySetupStrip
      propertyId={PROPERTY_ID}
      setup={{
        ...freshlyImported,
        attentionCount: 1,
        steps: freshlyImported.steps.map((step) =>
          step.key === 'ai_decision'
            ? { ...step, status: 'needs_admin' }
            : step.key === 'reviews_synced'
              ? { ...step, status: 'complete' }
              : step.status === 'pending'
                ? { ...step, status: 'complete' }
                : step,
        ),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('An account admin decides on AI')).toBeVisible()
    expect(canvas.queryByRole('link', { name: /decide on ai/i })).toBeNull()
  },
}

export const SetupStripHiddenWhenDone: Story = {
  render: () => (
    <div data-testid="strip-host">
      <PropertySetupStrip
        propertyId={PROPERTY_ID}
        setup={{
          ...freshlyImported,
          attentionCount: 0,
          steps: freshlyImported.steps.map((step) => ({
            ...step,
            status: step.key === 'ai_decision' ? 'deferred' : 'complete',
          })),
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByTestId('strip-host')).toBeEmptyDOMElement()
  },
}

export const ProfileResetRestoresTheSavedName: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PropertyProfileCard property={property} canEdit updateProperty={saveProfile} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()
    const name = canvas.getByLabelText('Workspace name')
    await userEvent.type(name, ' Varna')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(name).toHaveValue('Harborline Suites')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
  },
}

/**
 * The header names the section that is open, as an account settings page does: its title
 * and the end of its breadcrumb are the section, under "Settings", which links back to the
 * hub. The page has one h1, and the section's cards are h2s beneath it.
 */
export const HeaderNamesTheSection: Story = {
  render: () => {
    const header = propertySettingsHeader({
      propertyId: PROPERTY_ID,
      propertyName: property.name,
      active: 'google',
    })
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          title={header.title}
          description={property.name}
          breadcrumbs={header.breadcrumbs}
        />
        <PropertyGoogleSection
          property={{ id: PROPERTY_ID, googleBindingState: 'active' }}
        />
      </div>
    )
  },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(canvas.getByRole('heading', { level: 1, name: 'Google' })).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/settings`,
    )
    expect(
      canvas.getByText('Google', { selector: '[aria-current="page"]' }),
    ).toBeVisible()
    expect(
      canvas.getByRole('heading', { level: 2, name: 'Google Business Profile' }),
    ).toBeVisible()
  },
}

export const HeaderNamesTheSectionLight: Story = {
  ...HeaderNamesTheSection,
  parameters: { theme: 'light' },
}
