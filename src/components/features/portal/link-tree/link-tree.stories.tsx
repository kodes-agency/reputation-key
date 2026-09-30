// The Linktree section's body as the Pool & Terrace board draws it (round-4
// admin board 02): four tiles, two languages, the approval in place, the cap
// fact. The section's writes are stub actions, so each story can assert what a
// manager's gesture asks the server to save.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import { LinkTree } from './link-tree'
import type { LinktreeMutations } from './use-linktree-mutations'

// Wraps `fn` so the stub is callable like an action and reports no state.
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

const approvedBy = (
  userId: string | null,
  sourceType: 'custom' | 'recognized' = 'custom',
) => ({ state: 'approved', sourceType, approvedByUserId: userId }) as const

const tile = (
  id: string,
  sortKey: string,
  label: string,
  line: string | null,
  overrides: Partial<PortalLinktreeLink> = {},
): PortalLinktreeLink => ({
  id,
  categoryId: 'cat-1',
  url: `https://avela.bg/${id}`,
  iconKey: null,
  sortKey,
  texts: [
    { locale: 'en', label, line, provenance: null },
    { locale: 'bg', label: `${label} (БГ)`, line, provenance: null },
  ],
  destination: approvedBy('u-2'),
  ...overrides,
})

const FOUR_LINKS: ReadonlyArray<PortalLinktreeLink> = [
  tile('discover', 'a0', 'Discover the resort', 'Rooms, pools, the sea', {
    iconKey: 'waves',
  }),
  tile('spa', 'a1', 'Spa & treatments', 'Book a time', { iconKey: 'sparkles' }),
  tile('menu', 'a2', 'Olive Terrace menu', 'Lunch and dinner', {
    iconKey: 'utensils',
    // German would be the missing one on the board; here Bulgarian is.
    texts: [
      {
        locale: 'en',
        label: 'Olive Terrace menu',
        line: 'Lunch and dinner',
        provenance: null,
      },
    ],
  }),
  tile('getting-here', 'a3', 'Getting here', 'Directions and parking', {
    iconKey: 'map-pin',
  }),
]

const view = (overrides: Partial<PortalLinktreeView> = {}): PortalLinktreeView => ({
  portalId: 'p-1',
  enabled: true,
  maxLinks: 4,
  primaryLocale: 'en',
  locales: ['en', 'bg'],
  titles: { en: 'Around the resort' },
  links: FOUR_LINKS,
  ...overrides,
})

const MEMBER_NAMES = new Map([['u-2', 'Elena Petrova']])

type StoryProps = Readonly<{
  view: PortalLinktreeView
  mutations: LinktreeMutations
  canEdit: boolean
}>

function Harness({ view: current, mutations, canEdit }: StoryProps) {
  return (
    <div className="max-w-2xl p-6">
      <LinkTree
        view={current}
        mutations={mutations}
        memberNames={MEMBER_NAMES}
        canEdit={canEdit}
      />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Portal/Linktree',
  component: Harness,
  parameters: { theme: 'light' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
  ],
  args: { view: view(), mutations: stubMutations(), canEdit: true },
}
export default meta
type Story = StoryObj<typeof Harness>

const AUTOSAVE_WAIT = { timeout: 3000 }

export const FourTiles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('4 of 4 tiles in use')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add link' })).toBeDisabled()
    await expect(canvas.getByLabelText('Title on the page')).toHaveValue(
      'Around the resort',
    )
    // The tile with no Bulgarian text says so; the others do not.
    const languageLists = canvas.getAllByRole('list', { name: 'Languages' })
    await expect(languageLists[2]).toHaveTextContent('БГ missing')
    await expect(languageLists[0]).not.toHaveTextContent('missing')
  },
}

export const MovesATileFromTheKeyboard: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: 'Move Spa & treatments up' })
    await expect(
      canvas.getByRole('button', { name: 'Move Discover the resort up' }),
    ).toBeDisabled()
    up.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(args.mutations.reorderLinks).toHaveBeenCalledWith({
        data: {
          categoryId: 'cat-1',
          portalId: 'p-1',
          items: [
            { id: 'spa', sortKey: expect.any(String) },
            { id: 'discover', sortKey: expect.any(String) },
            { id: 'menu', sortKey: expect.any(String) },
            { id: 'getting-here', sortKey: expect.any(String) },
          ],
        },
      }),
    )
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Moved Spa & treatments to position 1 of 4',
    )
  },
}

export const OpenTileShowsTheApproval: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    await expect(canvas.getByLabelText('Opens')).toHaveValue('https://avela.bg/menu')
    await expect(canvas.getByText('Approved · Elena Petrova')).toBeVisible()
    // Bulgarian has no text yet: the tab says so, and so does the field.
    await userEvent.click(canvas.getByRole('radio', { name: 'БГ missing Bulgarian' }))
    await expect(
      canvas.getByText(/Bulgarian-speaking guests see it in English/),
    ).toBeVisible()
  },
}

export const TypedLabelIsSavedAsYouGo: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    const label = canvas.getByLabelText('Label')
    await userEvent.clear(label)
    await userEvent.type(label, 'Olive Terrace lunch')
    await waitFor(
      () =>
        expect(args.mutations.saveTexts).toHaveBeenCalledWith({
          data: {
            linkId: 'menu',
            texts: [
              { locale: 'en', label: 'Olive Terrace lunch', line: 'Lunch and dinner' },
            ],
          },
        }),
      AUTOSAVE_WAIT,
    )
  },
}

export const ChoosesAnIcon: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Getting here/ }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Car' }))
    await waitFor(() =>
      expect(args.mutations.updateLink).toHaveBeenCalledWith({
        data: { linkId: 'getting-here', iconKey: 'car' },
      }),
    )
  },
}

export const TitleIsSavedAndCanGoBackToTheDefault: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Use default' }))
    await waitFor(
      () =>
        expect(args.mutations.saveSettings).toHaveBeenCalledWith({
          data: {
            portalId: 'p-1',
            titles: [
              { locale: 'en', title: null },
              { locale: 'bg', title: null },
            ],
          },
        }),
      AUTOSAVE_WAIT,
    )
  },
}

export const AddsALink: Story = {
  args: {
    view: view({ links: FOUR_LINKS.slice(0, 2) }),
    mutations: stubMutations(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2 of 4 tiles in use')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await userEvent.type(canvas.getByLabelText('Label'), 'Kids club')
    await userEvent.type(canvas.getByLabelText('Opens'), 'https://avela.bg/kids')
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await waitFor(() =>
      expect(args.mutations.createLink).toHaveBeenCalledWith({
        data: { portalId: 'p-1', label: 'Kids club', url: 'https://avela.bg/kids' },
      }),
    )
  },
}

export const NoLinksYet: Story = {
  args: { view: view({ links: [], titles: {} }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/No links yet/)).toBeVisible()
    await expect(canvas.getByText('0 of 4 tiles in use')).toBeVisible()
  },
}

export const WaitingForApproval: Story = {
  args: {
    view: view({
      links: [
        tile('partner', 'a0', 'Partner offer', null, {
          destination: { state: 'pending', sourceType: 'custom', approvedByUserId: null },
        }),
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Partner offer/ }))
    await expect(canvas.getByText(/Waiting for approval/)).toBeVisible()
  },
}

export const HiddenFromThePage: Story = {
  args: { view: view({ enabled: false }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'The Linktree is hidden from the page. Your links are kept.',
      ),
    ).toBeVisible()
  },
}

export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Add link' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Move / })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /More actions/ })).toBeNull()
    await expect(canvas.getByLabelText('Title on the page')).toBeDisabled()
  },
}
