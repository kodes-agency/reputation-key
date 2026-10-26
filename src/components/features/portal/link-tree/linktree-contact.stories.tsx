// fallow-ignore-file code-duplication
// Phone and email tiles in the Linktree editor. A tile may open a phone number or
// an email address besides a website: the field says so, a saved number or
// address is shown without its `tel:` or `mailto:`, and such a tile needs no
// approval, so it carries no approval controls even for an account admin. The
// section's writes are stub actions, so each story can assert what a manager's
// gesture asks the server to save.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import type { LinkApprovalControls } from './link-approval-controls'
import { LinkTree } from './link-tree'
import type { LinktreeMutations } from './use-linktree-mutations'

function stubAction(impl: (input: unknown) => Promise<unknown> = async () => undefined) {
  return Object.assign(fn(impl), {
    isPending: false,
    error: null as unknown,
    isSuccess: false,
    data: null,
  })
}

function stubMutations(): LinktreeMutations {
  return {
    saveTexts: stubAction(),
    saveSettings: stubAction(),
    createLink: stubAction(async () => ({ link: { id: 'l-new' } })),
    updateLink: stubAction(),
    deleteLink: stubAction(),
    reorderLinks: stubAction(),
    updateFailure: null,
    clearUpdateFailure: fn(),
  } as unknown as LinktreeMutations
}

const contactTile = (
  id: string,
  sortKey: string,
  label: string,
  url: string,
  iconKey: 'phone' | 'mail',
): PortalLinktreeLink => ({
  id,
  categoryId: 'cat-1',
  url,
  iconKey,
  imageAssetId: null,
  sortKey,
  texts: [{ locale: 'en', label, line: null, provenance: null }],
  destination: { state: 'approved', sourceType: 'contact', approvedByUserId: 'u-2' },
})

const CONTACT_VIEW: PortalLinktreeView = {
  portalId: 'p-1',
  enabled: true,
  maxLinks: 4,
  primaryLocale: 'en',
  locales: ['en'],
  titles: { en: 'Around the resort' },
  links: [
    contactTile('call', 'a0', 'Call reception', 'tel:+15551234567', 'phone'),
    contactTile('write', 'a1', 'Write to us', 'mailto:front@avela.bg', 'mail'),
  ],
}

// An account admin's controls, with a site waiting: the contact tiles must not
// borrow them, because the list of sites never holds a phone number or address.
const adminControls = (): LinkApprovalControls => ({
  sites: [
    {
      id: 'site-partner',
      normalizedUri: 'https://avela.bg/partner',
      hostname: 'avela.bg',
      sourceType: 'custom',
      approvalState: 'pending',
      lastValidatedAt: '2026-10-01T09:00:00.000Z',
    },
  ],
  approve: fn(async () => undefined),
  turnOff: fn(async () => undefined),
  isBusy: false,
})

type HarnessProps = Readonly<{
  view: PortalLinktreeView
  mutations: LinktreeMutations
  approval?: LinkApprovalControls
}>

function Harness({ view, mutations, approval }: HarnessProps) {
  return (
    <div className="max-w-2xl p-6">
      <LinkTree
        propertyId="prop-1"
        view={view}
        mutations={mutations}
        memberNames={new Map([['u-2', 'Elena Petrova']])}
        canEdit
        canDelete
        approval={approval}
      />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Portal/Linktree/Phone and email',
  component: Harness,
  parameters: { theme: 'light' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
  ],
  args: { view: CONTACT_VIEW, mutations: stubMutations(), approval: adminControls() },
}
export default meta
type Story = StoryObj<typeof Harness>

const ADDRESS_LABEL = 'Website, phone or email'

/** A saved number reads as a number, needs no approval, and offers no approval controls. */
export const PhoneTileShowsTheNumberPlainly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Guests see both tiles: neither collapsed row warns.
    for (const name of [/^Call reception/, /^Write to us/]) {
      await expect(canvas.getByRole('button', { name })).not.toHaveTextContent(
        'Hidden from guests',
      )
    }
    await expect(canvas.getByText('2 of 4 tiles in use')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: /^Call reception/ }))
    const address = canvas.getByLabelText(ADDRESS_LABEL)
    await expect(address).toHaveValue('+15551234567')
    await expect(address).toHaveAccessibleDescription(
      'A website starting with https://, a phone number guests can call, or an email address they can write to.',
    )
    await expect(
      canvas.getByText('No approval needed · guests tap it to call or write'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Turn off' })).toBeNull()
  },
}

/** An email address reads without its `mailto:`. */
export const EmailTileShowsTheAddressPlainly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Write to us/ }))
    await expect(canvas.getByLabelText(ADDRESS_LABEL)).toHaveValue('front@avela.bg')
    await expect(canvas.queryByRole('button', { name: 'Turn off' })).toBeNull()
  },
}

/** Leaving the field unchanged saves nothing: the plain number is the saved one. */
export const LeavingAnUnchangedNumberSavesNothing: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Call reception/ }))
    await userEvent.click(canvas.getByLabelText(ADDRESS_LABEL))
    await userEvent.tab()
    await expect(args.mutations.updateLink).not.toHaveBeenCalled()
  },
}

/** A phone number is typed the way people write one; the server stores it in one form. */
export const AddsAPhoneNumber: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await userEvent.type(canvas.getByLabelText('Label'), 'Spa desk')
    await userEvent.type(canvas.getByLabelText(ADDRESS_LABEL), '+1 (555) 987-6543')
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await waitFor(() =>
      expect(args.mutations.createLink).toHaveBeenCalledWith({
        data: { portalId: 'p-1', label: 'Spa desk', url: '+1 (555) 987-6543' },
      }),
    )
  },
}

/** Two addresses in one field are refused in place, and nothing is sent. */
export const RefusesASecondRecipient: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await userEvent.type(canvas.getByLabelText('Label'), 'Events')
    await userEvent.type(
      canvas.getByLabelText(ADDRESS_LABEL),
      'events@avela.bg, spy@example.com',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await expect(
      await canvas.findByText(
        'Enter one email address, such as front@hotel.com, with nothing after it.',
      ),
    ).toBeVisible()
    await expect(args.mutations.createLink).not.toHaveBeenCalled()
  },
}
