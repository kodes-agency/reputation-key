// fallow-ignore-file code-duplication
// The Linktree section's body as the Pool & Terrace board draws it (round-4
// admin board 02): four tiles, two languages, the approval in place, the cap
// fact. The section's writes are stub actions, so each story can assert what a
// manager's gesture asks the server to save.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import { openAlertDialog } from '#/components/ui/confirmation-dialog.stories.open'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import type { PortalApprovedDestinationList } from '../portal-settings/portal-experience-settings-types'
import type { LinkApprovalControls } from './link-approval-controls'
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
  imageAssetId: null,
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
  canDelete?: boolean
  approval?: LinkApprovalControls
}>

function Harness({
  view: current,
  mutations,
  canEdit,
  canDelete = true,
  approval,
}: StoryProps) {
  return (
    <div className="max-w-2xl p-6">
      <LinkTree
        propertyId="prop-1"
        view={current}
        mutations={mutations}
        memberNames={MEMBER_NAMES}
        canEdit={canEdit}
        canDelete={canDelete}
        approval={approval}
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
    await expect(languageLists[2]).toHaveTextContent('BG missing')
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

// There is no grip: the two buttons are the whole control, and the arrow keys work
// on either one, so a tile is re-ordered from the keyboard without a drag handle.
export const MovesATileWithTheArrowKeys: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('button', { name: /^Reorder / }),
    ).not.toBeInTheDocument()
    const up = canvas.getByRole('button', { name: 'Move Spa & treatments up' })
    up.focus()
    await userEvent.keyboard('{ArrowUp}')
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
    // The arrow that was pressed is the move that was made, whichever button had focus.
    canvas.getByRole('button', { name: 'Move Getting here up' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(args.mutations.reorderLinks).toHaveBeenCalledTimes(1)
    canvas.getByRole('button', { name: 'Move Olive Terrace menu up' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(args.mutations.reorderLinks).toHaveBeenCalledTimes(2))
  },
}

// At phone width the list of languages is hidden and one chip stands in for it.
// (Both are in the page; `sm:` decides which one shows.)
export const PhoneChipNamesTheMissingLanguage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = canvas.getByText('BG missing')
    await expect(chip.className).toContain('sm:hidden')
  },
}

// From `sm` up a missing language is marked by an icon as well as by colour.
export const MissingLanguageChipHasAnIcon: Story = {
  play: async ({ canvasElement }) => {
    const languageLists = within(canvasElement).getAllByRole('list', {
      name: 'Languages',
    })
    await expect(languageLists[2]?.querySelector('svg')).not.toBeNull()
    await expect(languageLists[0]?.querySelector('svg')).toBeNull()
  },
}

// All six guest languages on one Portal, with a tile that has text in English
// only: five tabs read "XX missing". The label tabs must wrap, not run past the
// editor; the width is measured in `e2e/storybook-metrics/linktree-six-languages.metrics.ts`
// (the Vitest story runner compiles no Tailwind, so it cannot see overflow).
export const SixLanguagesWrapTheLanguageTabs: Story = {
  args: {
    view: view({
      locales: ['en', 'es', 'it', 'fr', 'de', 'bg'],
      titles: { en: 'Around the resort' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    const label = within(canvas.getByRole('radiogroup', { name: 'Label language' }))
    await expect(label.getAllByRole('radio')).toHaveLength(6)
    await expect(label.getAllByText(/ missing$/u)).toHaveLength(5)
    await expect(
      within(canvas.getByRole('radiogroup', { name: 'Title language' })).getAllByRole(
        'radio',
      ),
    ).toHaveLength(6)
  },
}

const slowSave = () => new Promise<undefined>((done) => setTimeout(done, 400))

// A write is still in flight when the manager presses the same arrow twice: each
// press plans from the order already on screen, so the tile ends two places down
// and the second order sent is not a copy of the first.
export const TwoQuickMovesBehindASlowWrite: Story = {
  args: {
    mutations: {
      ...stubMutations(),
      updateLink: stubAction(slowSave),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Getting here/ }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Car' }))
    const down = () =>
      userEvent.click(
        canvas.getByRole('button', { name: 'Move Discover the resort down' }),
      )
    await down()
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Moved Discover the resort to position 2 of 4',
    )
    await down()
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Moved Discover the resort to position 3 of 4',
    )
    await waitFor(() => expect(args.mutations.reorderLinks).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    })
    const ids = (call: number) =>
      mocked(args.mutations.reorderLinks).mock.calls[call]?.[0].data.items.map(
        (item: { id: string }) => item.id,
      )
    await expect(ids(0)).toEqual(['spa', 'discover', 'menu', 'getting-here'])
    await expect(ids(1)).toEqual(['spa', 'menu', 'discover', 'getting-here'])
  },
}

export const OpenTileShowsTheApproval: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    await expect(canvas.getByLabelText('Opens')).toHaveValue('https://avela.bg/menu')
    await expect(canvas.getByText('Approved · Elena Petrova')).toBeVisible()
    // Bulgarian has no text yet: the tab says so, and so does the field.
    await userEvent.click(canvas.getByRole('radio', { name: 'BG missing Bulgarian' }))
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

// A tile guests cannot see says so on its row, in the words the open tile uses,
// and the cap fact counts it: an approved tile stays quiet.
export const CollapsedTilesSayWhenGuestsCannotSeeThem: Story = {
  args: {
    view: view({
      links: [
        tile('discover', 'a0', 'Discover the resort', null),
        tile('partner', 'a1', 'Partner offer', null, {
          destination: { state: 'pending', sourceType: 'custom', approvedByUserId: null },
        }),
        tile('menu', 'a2', 'Olive Terrace menu', null, {
          destination: {
            state: 'disabled',
            sourceType: 'custom',
            approvedByUserId: null,
          },
        }),
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /^Partner offer/ }),
    ).toHaveTextContent('Hidden from guests · waiting for approval')
    await expect(
      canvas.getByRole('button', { name: /^Olive Terrace menu/ }),
    ).toHaveTextContent('Hidden from guests · turned off')
    await expect(
      canvas.getByRole('button', { name: /^Discover the resort/ }),
    ).not.toHaveTextContent('Hidden from guests')
    await expect(
      canvas.getByText('3 of 4 tiles in use · 2 hidden from guests'),
    ).toBeVisible()
  },
}

const PARTNER_SITE: PortalApprovedDestinationList['destinations'][number] = {
  id: 'site-partner',
  normalizedUri: 'https://avela.bg/partner',
  hostname: 'avela.bg',
  sourceType: 'custom',
  approvalState: 'pending',
  lastValidatedAt: '2026-10-01T09:00:00.000Z',
}

const approvalControls = (): LinkApprovalControls => ({
  sites: [PARTNER_SITE],
  approve: fn(async () => undefined),
  turnOff: fn(async () => undefined),
  isBusy: false,
})

const PARTNER_VIEW = view({
  links: [
    tile('partner', 'a0', 'Partner offer', null, {
      destination: { state: 'pending', sourceType: 'custom', approvedByUserId: null },
    }),
  ],
})

// The tile is where an address is approved: an account admin who opens a waiting
// tile approves it, or turns it off after a question, without leaving the tile.
export const AccountAdminApprovesFromTheTile: Story = {
  args: { view: PARTNER_VIEW, approval: approvalControls() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Partner offer/ }))
    await expect(canvas.getByText(/until you approve it/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(args.approval?.approve).toHaveBeenCalledWith('site-partner'),
    )

    const dialog = await openAlertDialog(canvasElement, 'Turn off')
    await expect(args.approval?.turnOff).not.toHaveBeenCalled()
    await expect(
      dialog.getByRole('heading', { name: 'Turn off avela.bg?' }),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Turn off site' }))
    await waitFor(() =>
      expect(args.approval?.turnOff).toHaveBeenCalledWith('site-partner'),
    )
  },
}

// A manager is told who approves, and is given no button for it.
export const ManagerIsToldWhoApproves: Story = {
  args: { view: PARTNER_VIEW },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Partner offer/ }))
    await expect(canvas.getByText(/until an account admin approves it/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Turn off' })).toBeNull()
  },
}

// An approved tile offers an account admin only "Turn off".
export const ApprovedTileOffersTurnOffToAnAccountAdmin: Story = {
  args: {
    view: view({
      links: [
        tile('partner', 'a0', 'Partner offer', null, {
          destination: approvedBy('u-2'),
        }),
      ],
    }),
    approval: approvalControls(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Partner offer/ }))
    await expect(canvas.getByText('Approved · Elena Petrova')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Turn off' })).toBeVisible()
  },
}

// The check can take seconds: the line under the field says so instead of showing
// the previous address's approval, then the approval comes back.
export const CheckingAnAddressIsShown: Story = {
  args: {
    mutations: {
      ...stubMutations(),
      updateLink: stubAction(
        () => new Promise<undefined>((done) => setTimeout(done, 700)),
      ),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    await expect(canvas.getByText('Approved · Elena Petrova')).toBeVisible()
    const address = canvas.getByLabelText('Opens')
    await userEvent.clear(address)
    await userEvent.type(address, 'https://avela.bg/menu-new')
    await userEvent.tab()
    await expect(await canvas.findByText('Checking address…')).toBeVisible()
    await expect(canvas.queryByText('Approved · Elena Petrova')).toBeNull()
    await waitFor(() => expect(canvas.queryByText('Checking address…')).toBeNull(), {
      timeout: 3000,
    })
    await expect(canvas.getByText('Approved · Elena Petrova')).toBeVisible()
  },
}

// A tile from before approvals can be checked from its approval line, and says
// "Checking address…" while that runs.
export const CheckThisAddressShowsChecking: Story = {
  args: {
    view: view({
      links: [
        tile('old', 'a0', 'Old link', null, {
          destination: {
            state: 'unclassified',
            sourceType: null,
            approvedByUserId: null,
          },
        }),
      ],
    }),
    mutations: {
      ...stubMutations(),
      updateLink: stubAction(
        () => new Promise<undefined>((done) => setTimeout(done, 700)),
      ),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Old link/ }))
    await expect(canvas.getByText(/^Not checked · /)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Check this address' }))
    await expect(await canvas.findByText('Checking address…')).toBeVisible()
    await waitFor(() =>
      expect(args.mutations.updateLink).toHaveBeenCalledWith({
        data: { linkId: 'old', url: 'https://avela.bg/old' },
      }),
    )
    await waitFor(() => expect(canvas.queryByText('Checking address…')).toBeNull(), {
      timeout: 3000,
    })
  },
}

// The chosen icon is checked the moment it is chosen, before the server answers.
// A refused write puts the saved icon back.
export const ChosenIconShowsAtOnce: Story = {
  args: {
    mutations: {
      ...stubMutations(),
      updateLink: stubAction(
        () =>
          new Promise<undefined>((_done, refuse) =>
            setTimeout(() => refuse(new Error('Not saved')), 600),
          ),
      ),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Getting here/ }))
    const car = canvas.getByRole('radio', { name: 'Car' })
    await expect(car).not.toBeChecked()
    await userEvent.click(car)
    await waitFor(() => expect(args.mutations.updateLink).toHaveBeenCalled())
    await expect(canvas.getByRole('radio', { name: 'Car' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Map pin' })).not.toBeChecked()
    // Refused: the saved icon is back.
    await waitFor(
      () => expect(canvas.getByRole('radio', { name: 'Car' })).not.toBeChecked(),
      {
        timeout: 3000,
      },
    )
    await expect(canvas.getByRole('radio', { name: 'Map pin' })).toBeChecked()
  },
}

// The icons are glyphs only: each one names itself on focus.
export const IconNamesShowOnFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Getting here/ }))
    canvas.getByRole('radio', { name: 'Concierge bell' }).focus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'Concierge bell',
    )
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

export const EditorWithoutDeletePermission: Story = {
  args: { canEdit: true, canDelete: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Spa & treatments' }),
    )
    const menu = within(document.body)
    await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(menu.queryByRole('menuitem', { name: 'Delete link…' })).toBeNull()
  },
}

async function openDeleteConfirmation(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', {
      name: 'More actions for Spa & treatments',
    }),
  )
  await userEvent.click(
    within(document.body).getByRole('menuitem', { name: 'Delete link…' }),
  )
  return within(await within(document.body).findByRole('alertdialog'))
}

// The confirmation waits for the delete and closes when it is done.
export const DeleteLinkConfirmsThenCloses: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const dialog = await openDeleteConfirmation(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Delete link' }))
    await waitFor(() =>
      expect(mocked(args.mutations.deleteLink)).toHaveBeenCalledWith({
        data: { linkId: 'spa' },
      }),
    )
    await waitFor(() =>
      expect(within(document.body).queryByRole('alertdialog')).toBeNull(),
    )
  },
}

// A refused delete stays in the dialog, once, and the dialog can be left again.
export const DeleteLinkRefusalStaysInTheDialog: Story = {
  args: {
    mutations: {
      ...stubMutations(),
      deleteLink: stubAction(async () => {
        throw new Error('The link could not be deleted')
      }),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDeleteConfirmation(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Delete link' }))
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    )
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('alertdialog')).toBeNull(),
    )
  },
}

export const BulgarianPrimaryPortalListsItsLanguageFirst: Story = {
  args: {
    view: view({
      primaryLocale: 'bg',
      locales: ['bg', 'en'],
      titles: {},
      links: FOUR_LINKS.slice(0, 1),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The title opens in the primary language, with that language's default.
    const tabs = within(canvas.getByRole('radiogroup', { name: 'Title language' }))
    await expect(tabs.getAllByRole('radio').map((tab) => tab.textContent)).toEqual([
      expect.stringContaining('BG'),
      expect.stringContaining('EN'),
    ])
    await expect(canvas.getByLabelText('Title on the page')).toHaveAttribute(
      'placeholder',
      'Полезни връзки',
    )
    await userEvent.click(tabs.getByRole('radio', { name: /EN/ }))
    await expect(canvas.getByLabelText('Title on the page')).toHaveAttribute(
      'placeholder',
      'Useful links',
    )
  },
}

export const LineWithoutALabelSaysItIsNotSaved: Story = {
  args: { mutations: stubMutations() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    await userEvent.click(canvas.getByRole('radio', { name: 'BG missing Bulgarian' }))
    await userEvent.type(canvas.getByLabelText(/^Line under the label/), 'Обяд')
    await expect(
      canvas.getByText(/Add a label first: a line is only saved together/),
    ).toBeVisible()
    await expect(args.mutations.saveTexts).not.toHaveBeenCalled()
  },
}

export const AddWaitsForTypedTextAndEarlierWrites: Story = {
  args: {
    view: view({ links: FOUR_LINKS.slice(0, 2) }),
    mutations: stubMutations(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // A title edit is still inside its debounce when the add is submitted.
    const title = canvas.getByLabelText('Title on the page')
    await userEvent.clear(title)
    await userEvent.type(title, 'Around the bay')
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await userEvent.type(canvas.getByLabelText('Label'), 'Kids club')
    await userEvent.type(canvas.getByLabelText('Opens'), 'https://avela.bg/kids')
    await userEvent.click(canvas.getByRole('button', { name: 'Add link' }))
    await waitFor(() => expect(args.mutations.createLink).toHaveBeenCalled())
    const [titleWrite] = mocked(args.mutations.saveSettings).mock.invocationCallOrder
    const [createWrite] = mocked(args.mutations.createLink).mock.invocationCallOrder
    // The title was written before the link was created.
    await expect(titleWrite).toBeDefined()
    await expect(titleWrite).toBeLessThan(createWrite ?? 0)
  },
}

// The server saves the address in its normalised form (here a trailing slash).
// The field must then show what was saved, or every later focus-and-leave would
// look like a change and write the same address again.
const normalisingUpdate = stubAction()

export const AddressShowsTheSavedFormAndIsNotWrittenTwice: Story = {
  render: function NormalisingHarness(args) {
    const [current, setCurrent] = useState(args.view)
    const [mutations] = useState<LinktreeMutations>(() => {
      normalisingUpdate.mockImplementation(async (input: unknown) => {
        const { linkId } = (input as { data: { linkId: string } }).data
        setCurrent((now) => ({
          ...now,
          links: now.links.map((link) =>
            link.id === linkId ? { ...link, url: 'https://avela.bg/menu/' } : link,
          ),
        }))
      })
      return { ...args.mutations, updateLink: normalisingUpdate } as LinktreeMutations
    })
    return <Harness {...args} view={current} mutations={mutations} />
  },
  play: async ({ canvasElement }) => {
    normalisingUpdate.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Olive Terrace menu/ }))
    const address = canvas.getByLabelText('Opens')
    await userEvent.clear(address)
    await userEvent.type(address, 'https://AVELA.bg/menu')
    await userEvent.tab()
    await waitFor(() =>
      expect(canvas.getByLabelText('Opens')).toHaveValue('https://avela.bg/menu/'),
    )
    // Leaving the field again without a change writes nothing more.
    await userEvent.click(canvas.getByLabelText('Opens'))
    await userEvent.tab()
    await expect(normalisingUpdate).toHaveBeenCalledTimes(1)
  },
}

export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Add link' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^(Move|Reorder) / })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /More actions/ })).toBeNull()
    await expect(canvas.getByLabelText('Title on the page')).toBeDisabled()
  },
}
