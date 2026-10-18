// Every door from the Monthly portal goal card to its set sheet (PLAN PG-10):
// "Change" on the ready card, "Set a private ratings number" with scans first,
// "Set my own number" in the first weeks and while the recommendation cannot
// be read, and "Set a number anyway" when nothing came in. Each opens the sheet
// on what the card read sent, as the Goals page's host does; the gates have no
// door. The Storybook Vitest project compiles no Tailwind, so the plays assert
// words, roles and what opens.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalSection } from './portal-goal-section'
import { PortalGoalSheet } from './portal-goal-sheet'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-view'
import {
  CARD_DRAFTS_ONE,
  CARD_GETTING_READY,
  CARD_NOTHING,
  CARD_NO_PORTAL,
  CARD_READY,
  CARD_REC_UNREADABLE,
  CARD_SCANS_ONLY,
  SEAVIEW,
} from './portal-goal.stories.fixtures'

const setMock = fn<PortalGoalCommands['setMonthlyPortalGoalFn']>(async () => ({
  programId: 'program-monthly',
}))
const onSetMock = fn<PortalGoalCommands['onSet']>(async () => undefined)
const openSheetMock = fn<NonNullable<PortalGoalCommands['openSheet']>>()

/** The card in its section, its doors opening the sheet on the card's own read. */
function Doors({ card }: Readonly<{ card: PortalGoalCardView }>) {
  const [opening, setOpening] = useState<{
    intent: PortalGoalSheetIntent
    open: boolean
    key: number
  } | null>(null)
  const commands: PortalGoalCommands = {
    setMonthlyPortalGoalFn: setMock,
    onSet: onSetMock,
    openSheet: (intent) => {
      openSheetMock(intent)
      setOpening((last) => ({ intent, open: true, key: (last?.key ?? 0) + 1 }))
    },
  }
  const close = () =>
    setOpening((last) => (last === null ? null : { ...last, open: false }))
  return (
    <div className="max-w-5xl">
      <PortalGoalSection
        propertyId={SEAVIEW.propertyId}
        card={{ data: card, failed: false, retrying: false, retry: fn() }}
        canCreatePortal
        commands={commands}
      />
      {opening === null || !('sheet' in card) ? null : (
        <PortalGoalSheet
          key={opening.key}
          open={opening.open}
          onOpenChange={(open) => {
            if (!open) close()
          }}
          onSettled={close}
          propertyId={SEAVIEW.propertyId}
          facts={card.sheet}
          intent={opening.intent}
          commands={commands}
        />
      )}
    </div>
  )
}

const meta: Meta<typeof Doors> = {
  title: 'Goals/PortalGoalCardDoors',
  component: Doors,
  parameters: { layout: 'padded' },
  args: { card: CARD_READY },
  beforeEach: () => {
    setMock.mockClear()
    onSetMock.mockClear()
    openSheetMock.mockClear()
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Presses the door and returns the sheet it opened. */
async function openThrough(canvasElement: HTMLElement, door: string) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: door }))
  return within(
    await within(document.body).findByRole('dialog', { name: 'Monthly portal goal' }),
  )
}

/** "Change" beside Use: the sheet opens on the recommended 40 for November. */
export const ReadyChange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Use 40' })).toBeVisible()
    const sheet = await openThrough(canvasElement, 'Change')
    await expect(openSheetMock).toHaveBeenCalledWith({ measure: 'portal_rating_count' })
    await expect(sheet.getByRole('spinbutton')).toHaveValue('40')
    await expect(sheet.getByRole('radio', { name: /^40 · a bit more/u })).toBeChecked()
    await userEvent.click(sheet.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await expect(setMock).not.toHaveBeenCalled()
  },
}

export const ReadyChangeOnANarrowPhone: Story = {
  ...ReadyChange,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Scans first (P-2): the door is to private ratings, which have no number yet. */
export const ScansOnlyPrivateRatings: Story = {
  args: { card: CARD_SCANS_ONLY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Change' })).toBeNull()
    const sheet = await openThrough(canvasElement, 'Set a private ratings number')
    await expect(openSheetMock).toHaveBeenCalledWith({ measure: 'portal_rating_count' })
    await expect(sheet.getByRole('spinbutton')).toHaveValue('')
    await expect(sheet.getByText('No recommendation yet.')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Count scans instead' }))
    await expect(sheet.getByRole('spinbutton')).toHaveValue('55')
  },
}

/** The first weeks: a number of their own, the box empty and Set waiting for it. */
export const GettingReadyOwnNumber: Story = {
  args: { card: CARD_GETTING_READY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Use /u })).toBeNull()
    const sheet = await openThrough(canvasElement, 'Set my own number')
    await expect(sheet.getByRole('spinbutton')).toHaveValue('')
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await userEvent.type(sheet.getByRole('spinbutton'), '12')
    await expect(sheet.getByRole('button', { name: 'Set 12 for October' })).toBeEnabled()
  },
}

export const GettingReadyOwnNumberLight: Story = {
  ...GettingReadyOwnNumber,
  parameters: { theme: 'light' },
}

/** A recommendation that cannot be read: a number of their own all the same. */
export const UnreadableOwnNumber: Story = {
  args: { card: CARD_REC_UNREADABLE },
  play: async ({ canvasElement }) => {
    const sheet = await openThrough(canvasElement, 'Set my own number')
    await expect(sheet.getByText('No recommendation yet.')).toBeVisible()
    // November is the month it opens on; this month's figure cannot be read.
    await expect(sheet.getByText('Starts on Nov 1.')).toBeVisible()
    await userEvent.click(sheet.getByRole('radio', { name: 'October' }))
    await expect(sheet.getByText('Counts from Oct 1.')).toBeVisible()
  },
}

/** Nothing came in: "Set a number anyway", beside the way to the codes. */
export const NothingCountedAnyway: Story = {
  args: { card: CARD_NOTHING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Open portals' })).toBeVisible()
    const sheet = await openThrough(canvasElement, 'Set a number anyway')
    await expect(sheet.getByRole('spinbutton')).toHaveValue('')
    await expect(openSheetMock).toHaveBeenCalledWith({ measure: 'portal_rating_count' })
  },
}

/** Before a Portal is live there is nothing to count, so no door. */
export const GatesHaveNoDoor: Story = {
  args: { card: CARD_NO_PORTAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Create a portal' })).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

export const DraftsHaveNoDoor: Story = {
  args: { card: CARD_DRAFTS_ONE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Open Spa' })).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}
