import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import { PortalApprovedDestinationsEditor } from './portal-approved-destinations-editor'
import { PortalLocalizedContentEditor } from './portal-localized-content-editor'
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
      <PortalLocalizedContentEditor
        locale="en"
        isPrimary
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
  // The forms register with the portal's autosave coordinator, which the
  // workspace layout provides in the app.
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PortalExperienceFormsShowcase>

/** Opens the folded list of sites allowed for links and adds `address`. */
async function addSite(canvasElement: HTMLElement, address: string) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /sites allowed for links/i }))
  await userEvent.type(canvas.getByLabelText('Site address'), address)
  await userEvent.click(canvas.getByRole('button', { name: /add site/i }))
}

export const CommandsUseSharedDtos: Story = {
  args: { actions: experienceActions() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    // The property's wording is written, so its fold starts closed.
    await userEvent.click(canvas.getByRole('button', { name: /property wording/i }))
    await userEvent.click(canvas.getByRole('button', { name: /save property wording/i }))
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

    // This portal's own wording is part of its draft: no Save button, it is
    // written a moment after the person stops typing.
    await expect(
      canvas.queryByRole('button', { name: /save portal override/i }),
    ).not.toBeInTheDocument()
    await userEvent.type(
      canvas.getByLabelText('Welcome line', { selector: '#portal-override-title-en' }),
      'Pool',
    )
    await waitFor(
      () =>
        expect(args.actions.saveOverride).toHaveBeenCalledWith({
          data: {
            portalId: 'portal-1',
            locale: 'en',
            title: 'Pool',
            shortDescription: null,
          },
        }),
      { timeout: 3000 },
    )

    // The list of sites is folded while nothing waits: open it to add one.
    await addSite(canvasElement, 'https://example.com/reviews')
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
    await addSite(canvasElement, 'http://localhost/reviews')
    await expect(await canvas.findByText(/enter a public https address/i)).toBeVisible()
    expect(args.actions.requestDestination).not.toHaveBeenCalled()
  },
}
