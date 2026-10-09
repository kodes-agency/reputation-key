import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'
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
      canvas.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-en',
      }),
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

/**
 * Bulgarian has no property wording until "Save property wording" lands, which
 * this wrapper answers by adding the row, as the server read would.
 */
function WordingArrives() {
  const [content, setContent] = useState(experience.content)
  const actions = useMemo<PortalExperienceActions>(() => {
    const saveContent: PortalExperienceActions['saveContent'] = Object.assign(
      fn(async ({ data }: Parameters<PortalExperienceActions['saveContent']>[0]) => {
        setContent((rows) => [...rows, { ...data, version: 1 }])
      }),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as unknown as PortalExperienceActions['saveContent']
    return { ...experienceActions(), saveContent }
  }, [])
  return (
    <div className="p-6">
      <PortalLocalizedContentEditor
        locale="bg"
        isPrimary={false}
        propertyId="property-1"
        portalId="portal-1"
        experience={{ ...experience, content }}
        actions={actions}
        disabled={false}
      />
    </div>
  )
}

// Without property wording the card puts that wording first; once it is saved
// the card turns back to its usual order. The portal's own line moves with it
// rather than being thrown away and drawn again, so a line still being saved
// survives the change.
export const SavedWordingKeepsThePortalsOwnLine: Story = {
  args: { actions: experienceActions() },
  render: () => <WordingArrives />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ownLine = () =>
      canvas.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-bg',
      })
    const before = ownLine()
    await userEvent.type(before, 'Басейн')
    await userEvent.type(
      canvas.getByLabelText('Welcome line for every portal', {
        selector: '#portal-content-title-bg',
      }),
      'Добре дошли',
    )
    await userEvent.type(
      canvas.getByLabelText('Link preview for every portal', {
        selector: '#portal-content-description-bg',
      }),
      'Разкажете ни за престоя си.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Save property wording' }))
    await waitFor(() =>
      expect(canvas.queryByText(/has no property wording yet/)).not.toBeInTheDocument(),
    )
    await expect(ownLine()).toBe(before)
    await expect(ownLine()).toHaveValue('Басейн')
    await expect(
      Boolean(
        ownLine().compareDocumentPosition(
          canvas.getByRole('button', { name: /Property wording/ }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  },
}
