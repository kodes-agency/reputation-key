// Portal creation with preview — two-panel layout: CreatePortalForm on the left,
// a live PublicPortalContent preview on the right (toggled). The preview reacts
// to form input via onPreviewChange. No usePermissions — no authed router.
//
// The preview panel is `hidden lg:block` (hidden below the lg breakpoint) but
// stays in the DOM, so play-function assertions find it regardless of viewport;
// the story still uses a wide viewport so the preview is visually present.
import type { Meta, StoryObj } from '@storybook/react'
import { type ComponentProps } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { PortalCreationWithPreview } from './portal-creation-with-preview'
import type { Action } from '#/components/hooks/use-action'

type CreatePortalVariables = {
  data: {
    name: string
    slug?: string
    description?: string
    propertyId: string
  }
}

const meta: Meta<typeof PortalCreationWithPreview> = {
  title: 'Portal/PortalCreationWithPreview',
  component: PortalCreationWithPreview,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktopManager' },
  },
}
export default meta
type Story = StoryObj<typeof PortalCreationWithPreview>

const idleMutation = Object.assign(
  async (_input: CreatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<CreatePortalVariables, { success: boolean }>

// The component persists its preview-open flag to localStorage and reads it on
// mount. Stories share a single browser page (and thus one localStorage), so a
// variant that toggles the preview on would leak "open" into the next variant's
// mount — making the toggle read "Hide Preview" instead of "Show Preview" and
// breaking the play fns. `render` runs at mount time (before the component's
// useState initializer), so clearing the key here guarantees every variant
// starts with the preview hidden.
const PREVIEW_STORAGE_KEY = 'portal-creation-preview-open'
function renderFresh(args: ComponentProps<typeof PortalCreationWithPreview>) {
  try {
    localStorage.removeItem(PREVIEW_STORAGE_KEY)
  } catch {
    // ignore storage errors (sandbox / private mode)
  }
  return <PortalCreationWithPreview {...args} />
}

export const Default: Story = {
  args: {
    propertyId: 'prop-1',
    mutation: idleMutation,
  },
  render: renderFresh,
}

// Preview hidden initially (localStorage flag absent) — toggle button shown.
export const PreviewHidden: Story = {
  args: { ...Default.args },
  render: renderFresh,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /show preview/i }),
    ).toBeInTheDocument()
  },
}

// Live preview: toggling Show Preview then typing a name updates the preview's
// portal title in real time (onPreviewChange → previewPortal.name).
export const LivePreview: Story = {
  args: { ...Default.args },
  render: renderFresh,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /show preview/i }))
    await userEvent.type(canvas.getByLabelText('Name'), 'Sunset Lodge')
    // Preview reflects the typed name.
    await expect(await canvas.findByText('Sunset Lodge')).toBeInTheDocument()
  },
}

// Typing a description also flows through to the preview.
export const PreviewReflectsDescription: Story = {
  args: { ...Default.args },
  render: renderFresh,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /show preview/i }))
    await userEvent.type(canvas.getByLabelText('Name'), 'Harbor Inn')
    const description = canvas.getByLabelText(/description/i)
    await userEvent.type(description, 'Waterfront getaway')
    // The description text now appears in BOTH the form textarea (its value)
    // and the live preview's <p>. Scope the assertion to the preview <p> so
    // getByText finds a unique element.
    await expect(
      await canvas.findByText('Waterfront getaway', { selector: 'p' }),
    ).toBeInTheDocument()
  },
}

// Toggle off after showing — preview panel leaves the DOM (Hide Preview).
export const TogglePreviewOff: Story = {
  args: { ...Default.args },
  render: renderFresh,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const showBtn = canvas.getByRole('button', { name: /show preview/i })
    await userEvent.click(showBtn)
    const hideBtn = await canvas.findByRole('button', { name: /hide preview/i })
    await userEvent.click(hideBtn)
    await expect(
      canvas.getByRole('button', { name: /show preview/i }),
    ).toBeInTheDocument()
  },
}
