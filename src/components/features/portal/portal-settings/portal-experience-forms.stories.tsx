import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { PortalApprovedDestinationsEditor } from './portal-approved-destinations-editor'
import { PortalLocalizedContentEditor } from './portal-localized-content-editor'
import { PortalPropertyBrandEditor } from './portal-property-brand-editor'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
  PortalExperienceSettings,
} from './portal-experience-settings-types'

function idleAction<TInput>(): Action<TInput> {
  return Object.assign(
    fn(async (_input: TInput) => undefined),
    {
      isPending: false,
      error: null,
      isSuccess: false,
      data: null,
    },
  ) as unknown as Action<TInput>
}

function experienceActions(): PortalExperienceActions {
  return {
    saveProfile: idleAction(),
    saveContent: idleAction(),
    saveOverride: idleAction(),
    requestDestination: idleAction(),
    approveDestination: idleAction(),
    disableDestination: idleAction(),
  }
}

const experience: PortalExperienceSettings = {
  profile: {
    displayName: 'Example Hotel',
    primaryColor: '#2563EB',
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
  },
  content: [
    {
      locale: 'en',
      title: 'Welcome',
      shortDescription: 'Tell us about your stay.',
      version: 1,
    },
  ],
  overrides: [],
  canManagePropertyBrand: true,
}

const destinations: PortalApprovedDestinationList = {
  destinations: [],
  canApprove: true,
}

type ShowcaseProps = Readonly<{ actions: PortalExperienceActions }>

function PortalExperienceFormsShowcase({ actions }: ShowcaseProps) {
  return (
    <div className="space-y-4 p-6">
      <PortalPropertyBrandEditor
        propertyId="property-1"
        experience={experience}
        action={actions.saveProfile}
        disabled={false}
      />
      <PortalLocalizedContentEditor
        locale="en"
        propertyId="property-1"
        portalId="portal-1"
        experience={experience}
        actions={actions}
        disabled={false}
      />
      <PortalApprovedDestinationsEditor
        portalId="portal-1"
        state={destinations}
        actions={actions}
        disabled={false}
      />
    </div>
  )
}

const meta: Meta<typeof PortalExperienceFormsShowcase> = {
  title: 'Portal/PortalExperienceForms',
  component: PortalExperienceFormsShowcase,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof PortalExperienceFormsShowcase>

export const CommandsUseSharedDtos: Story = {
  args: { actions: experienceActions() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    const displayName = canvas.getByLabelText(/public display name/i)
    await userEvent.clear(displayName)
    await userEvent.type(displayName, '  Grand Hotel  ')
    await userEvent.click(canvas.getByRole('button', { name: /save property brand/i }))
    await waitFor(() =>
      expect(args.actions.saveProfile).toHaveBeenCalledWith({
        data: {
          propertyId: 'property-1',
          displayName: 'Grand Hotel',
          primaryColor: '#2563EB',
          backgroundColor: '#FFFFFF',
          textColor: '#111827',
        },
      }),
    )

    await userEvent.click(canvas.getByRole('button', { name: /save property fallback/i }))
    await waitFor(() =>
      expect(args.actions.saveContent).toHaveBeenCalledWith({
        data: {
          propertyId: 'property-1',
          locale: 'en',
          title: 'Welcome',
          shortDescription: 'Tell us about your stay.',
        },
      }),
    )

    await userEvent.click(canvas.getByRole('button', { name: /save portal override/i }))
    await waitFor(() =>
      expect(args.actions.saveOverride).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          locale: 'en',
          title: null,
          shortDescription: null,
        },
      }),
    )

    await userEvent.type(
      canvas.getByPlaceholderText('https://example.com/your-page'),
      'https://example.com/reviews',
    )
    await userEvent.click(canvas.getByRole('button', { name: /add destination/i }))
    await waitFor(() =>
      expect(args.actions.requestDestination).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', uri: 'https://example.com/reviews' },
      }),
    )
  },
}

export const UnsafeDestinationRejected: Story = {
  args: { actions: experienceActions() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByPlaceholderText('https://example.com/your-page'),
      'http://localhost/reviews',
    )
    await userEvent.click(canvas.getByRole('button', { name: /add destination/i }))
    await expect(await canvas.findByText(/enter a public https address/i)).toBeVisible()
    expect(args.actions.requestDestination).not.toHaveBeenCalled()
  },
}
