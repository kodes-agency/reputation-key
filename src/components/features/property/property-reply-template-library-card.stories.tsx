import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { PropertyReplyTemplateLibraryCard } from './property-reply-template-library-card'

type SaveAction = ComponentProps<typeof PropertyReplyTemplateLibraryCard>['saveAction']
type SaveInput = Parameters<SaveAction>[0]
type ToggleAction = ComponentProps<
  typeof PropertyReplyTemplateLibraryCard
>['toggleAction']
type ToggleInput = Parameters<ToggleAction>[0]

const saveSpy = fn(async (_input: SaveInput) => undefined)
const saveAction = Object.assign(saveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction
const toggleSpy = fn(async (_input: ToggleInput) => undefined)
const toggleAction = Object.assign(toggleSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as ToggleAction

const PROPERTY_ID = '76000000-0000-4000-8000-000000000001'
const PROFILE = {
  greeting: 'Dear {guest_name},',
  signOffPositive: 'Warm regards,\nHarborline team',
  signOffNegative: 'Sincerely,\nGuest relations',
  emojiAllowed: false,
  escalationContact: 'care@harborline.example',
  version: 2,
}
const TEMPLATE = {
  id: '76000000-0000-4000-8000-000000000002',
  title: 'General appreciation',
  ratingMin: 4,
  ratingMax: 5,
  hasText: true,
  aspect: null,
  openLabel: null,
  languageTag: 'en-Latn-US',
  body: 'Thank you, {guest_name}. Contact {escalation_contact} if we can help. 🌟',
  enabled: true,
  version: 3,
}
const RECOVERY_TEMPLATE = {
  ...TEMPLATE,
  id: '76000000-0000-4000-8000-000000000003',
  title: 'Service recovery',
  ratingMin: 1,
  ratingMax: 2,
  hasText: false,
  aspect: 'service' as const,
  body: 'We are sorry your visit fell short.',
  enabled: false,
}

const meta = {
  title: 'Property/PropertyReplyTemplateLibraryCard',
  component: PropertyReplyTemplateLibraryCard,
  decorators: [
    withRole('AccountAdmin'),
    (Story) => (
      <div className="w-[min(76rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'centered' },
  args: {
    propertyId: PROPERTY_ID,
    profile: PROFILE,
    templates: [TEMPLATE, RECOVERY_TEMPLATE],
    defaultLanguageTag: 'en-Latn-US',
    saveAction,
    toggleAction,
  },
} satisfies Meta<typeof PropertyReplyTemplateLibraryCard>

export default meta
type Story = StoryObj<typeof meta>

async function openEditor(canvasElement: HTMLElement, name: string) {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
  return within(await within(document.body).findByRole('dialog'))
}

async function replaceBody(dialog: ReturnType<typeof within>, value: string) {
  const body = dialog.getByLabelText('Template body')
  await userEvent.clear(body)
  await userEvent.click(body)
  await userEvent.paste(value)
}

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    toggleSpy.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.getByText('General appreciation')).toBeVisible()
    expect(canvas.getByText('4–5 stars')).toBeVisible()
    expect(canvas.getByText('Rating only')).toBeVisible()
    await userEvent.click(
      canvas.getByRole('switch', { name: 'Disable General appreciation' }),
    )
    await waitFor(() =>
      expect(toggleSpy).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          templateId: TEMPLATE.id,
          enabled: false,
        },
      }),
    )
  },
}

export const Empty: Story = {
  args: { templates: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getByText('No reply templates yet')).toBeVisible()
    const dialog = await openEditor(canvasElement, 'Add template')
    expect(dialog.getByRole('heading', { name: 'Add reply template' })).toBeVisible()
  },
}

export const PermissionDenied: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getByText(/ask a property manager or account admin/i)).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Add template' })).not.toBeInTheDocument()
    expect(
      canvas.queryByRole('button', { name: `Edit ${TEMPLATE.title}` }),
    ).not.toBeInTheDocument()
  },
}

export const RowEditorWithLivePreview: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openEditor(canvasElement, `Edit ${TEMPLATE.title}`)

    expect(dialog.getByLabelText('Rendered reply preview')).toHaveTextContent(
      'Dear {guest_name},',
    )
    expect(dialog.getByLabelText('Rendered reply preview')).toHaveTextContent(
      'Contact care@harborline.example if we can help.',
    )
    expect(dialog.getByLabelText('Rendered reply preview')).toHaveTextContent(
      'Warm regards, Harborline team',
    )
    expect(dialog.getByLabelText('Rendered reply preview')).not.toHaveTextContent('🌟')
    for (const slot of [
      '{guest_name}',
      '{staff_name}',
      '{dish}',
      '{event_type}',
      '{escalation_contact}',
    ]) {
      expect(dialog.getByText(slot)).toBeVisible()
    }
  },
}

export const BodyWithoutSlotsWarnsButSaves: Story = {
  play: async ({ canvasElement }) => {
    saveSpy.mockClear()
    const dialog = await openEditor(canvasElement, `Edit ${TEMPLATE.title}`)
    await replaceBody(dialog, 'Thank you for visiting us again.')
    expect(await dialog.findByText('No slots in this body')).toBeVisible()
    expect(dialog.getByText(/that is allowed/i)).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Save template' }))

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          templateId: TEMPLATE.id,
          template: {
            title: TEMPLATE.title,
            ratingMin: TEMPLATE.ratingMin,
            ratingMax: TEMPLATE.ratingMax,
            hasText: TEMPLATE.hasText,
            aspect: TEMPLATE.aspect,
            openLabel: TEMPLATE.openLabel,
            languageTag: TEMPLATE.languageTag,
            body: 'Thank you for visiting us again.',
            enabled: TEMPLATE.enabled,
          },
        },
      }),
    )
  },
}

export const UnsupportedSlot: Story = {
  play: async ({ canvasElement }) => {
    saveSpy.mockClear()
    const dialog = await openEditor(canvasElement, `Edit ${TEMPLATE.title}`)
    await replaceBody(dialog, 'Welcome to {property_name}.')
    await userEvent.click(dialog.getByRole('button', { name: 'Save template' }))

    expect(
      await dialog.findByText('Unsupported reply template slot: {property_name}'),
    ).toBeVisible()
    expect(saveSpy).not.toHaveBeenCalled()
  },
}

export const Rename: Story = {
  play: async ({ canvasElement }) => {
    saveSpy.mockClear()
    const dialog = await openEditor(canvasElement, `Edit ${TEMPLATE.title}`)
    const title = dialog.getByLabelText('Template title')

    await userEvent.clear(title)
    await userEvent.type(title, 'Signature appreciation')
    await userEvent.click(dialog.getByRole('button', { name: 'Save template' }))

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          templateId: TEMPLATE.id,
          template: expect.objectContaining({
            title: 'Signature appreciation',
            body: TEMPLATE.body,
          }),
        },
      }),
    )
  },
}
