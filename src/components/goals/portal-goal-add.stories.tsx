// "Add a portal goal" under a manager's hands (PLAN PG-20; copy deck M-1…M-14):
// the choice (with the average closed under 10 private ratings), a goal for one
// portal from its number step (Reception · December, 20 · 22 · 24), each portal
// (a new Spa unticked, and a row the save could not keep), a group, the average,
// an old link's step, a portal that has a goal (and one taken while its number
// step was open), the average held, and no door at all where there is nothing
// to add. On Seaview's Nov 22 (December offered) unless named. The
// Storybook Vitest project compiles no Tailwind, so the plays assert words,
// roles, focus and what Set sends.
import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { Button } from '#/components/ui/button'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import {
  PortalGoalAddSheet,
  type PortalGoalAddCommands,
  type PortalGoalAddOpening,
} from './portal-goal-add-sheet'
import { portalGoalAddOffered } from './portal-goal-add-view'
import {
  ADD_AVERAGE_DISABLED,
  ADD_EACH_OCT_23,
  ADD_IDS,
  ADD_NOTHING,
  ADD_RECEPTION_HELD,
  ADD_SEAVIEW,
} from './portal-goal-add.stories.fixtures'

const PROPERTY_ID = 'd0000000-0000-4000-8000-000000000001'

const addOneMock = fn<PortalGoalAddCommands['addPortalGoalFn']>(async () => ({
  programId: 'program-added',
}))
const addEachMock = fn<PortalGoalAddCommands['addPortalGoalsFn']>(async ({ data }) => ({
  outcomes: data.items.map(({ portalId }) => ({ portalId, saved: true })),
}))
const onAddedMock = fn<PortalGoalAddCommands['onAdded']>(async () => undefined)

const refusal = (code: string) =>
  new ServerFunctionError('GoalProgramError', code, code, 409)

type HarnessProps = Readonly<{
  options: PortalGoalAddOptions
  opening?: PortalGoalAddOpening
  /** What the page does once goals were added: read them again. */
  onAdded?: PortalGoalAddCommands['onAdded']
}>

/**
 * A page with the door as the hosts draw it (only when there is something to
 * add, the M-rule): a fresh sheet for every opening, closed once a goal is
 * added, and the focus handed back to the door.
 */
function Harness({
  options,
  opening = { step: 'choose', subject: null },
  onAdded = onAddedMock,
}: HarnessProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const door = useRef<HTMLButtonElement>(null)
  if (!portalGoalAddOffered(options)) return <p>Nothing to add here.</p>
  return (
    <>
      <Button
        ref={door}
        variant="link"
        size="inline"
        onClick={() => {
          setOpen(true)
          setKey((last) => last + 1)
        }}
      >
        Add a portal goal
      </Button>
      <PortalGoalAddSheet
        key={key}
        open={open}
        onOpenChange={setOpen}
        onSettled={() => setOpen(false)}
        propertyId={PROPERTY_ID}
        options={options}
        opening={opening}
        commands={{
          addPortalGoalFn: addOneMock,
          addPortalGoalsFn: addEachMock,
          onAdded,
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!open) door.current?.focus()
        }}
      />
    </>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Goals/PortalGoalAdd',
  component: Harness,
  args: { options: ADD_SEAVIEW },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story; a Toaster that mounts replays what still shows.
    toast.dismiss()
    for (const mock of [addOneMock, addEachMock, onAddedMock]) mock.mockClear()
  },
}

export default meta
type Story = StoryObj<typeof meta>

async function openSheet(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Add a portal goal' }),
  )
  const sheet = await within(document.body).findByRole('dialog', {
    name: 'Add a portal goal',
  })
  return { sheet, in: within(sheet) }
}

type Sheet = Awaited<ReturnType<typeof openSheet>>['in']

async function expectToast(text: string) {
  const shown = await within(document.body).findByText(text)
  await waitFor(() => expect(shown).toBeVisible())
}

const CHOICES = [
  'A goal for one portal',
  'A goal for each portal',
  'A goal for a portal group',
  'Average private rating',
]

async function expectTheChoice(sheet: Sheet) {
  await expect(sheet.getByText('What do you want to add?')).toBeVisible()
  const radios = sheet.getAllByRole('radio')
  await expect(radios).toHaveLength(CHOICES.length)
  for (const [index, name] of CHOICES.entries()) {
    await expect(radios[index]?.getAttribute('id')).toBe(
      sheet.getByRole('radio', { name: (label) => label.startsWith(name) }).id,
    )
  }
  await expect(
    sheet.getByText('Portal goals are about the spot, not the person who works there.'),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Next' })).toBeDisabled()
}

/** M-2…M-8: what to add; Next waits for a choice; Cancel hands the focus back. */
export const Choose: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-add', 'dialog')
    await expectTheChoice(inSheet)
    await expect(inSheet.getAllByRole('radio')[0]).toHaveFocus()
    await userEvent.click(inSheet.getByRole('radio', { name: /^A goal for one portal/u }))
    await expect(inSheet.getByRole('button', { name: 'Next' })).toBeEnabled()
    await userEvent.click(inSheet.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'Add a portal goal' }),
      ).toHaveFocus(),
    )
  },
}

export const ChooseOnAPhone: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-add', 'sheet')
    await expectTheChoice(inSheet)
  },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const ChooseOnATablet: Story = {
  play: async ({ canvasElement }) => {
    const { in: inSheet } = await openSheet(canvasElement)
    await expectTheChoice(inSheet)
  },
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const ChooseOnADesktop: Story = {
  ...ChooseOnATablet,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const ChooseLight: Story = {
  ...ChooseOnATablet,
  parameters: { theme: 'light' },
}

/** M-6: under 10 private ratings in 4 weeks the average is closed, and says why. */
export const AverageDisabled: Story = {
  args: { options: ADD_AVERAGE_DISABLED },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await expect(
      sheet.getByRole('radio', { name: /^Average private rating/u }),
    ).toBeDisabled()
    await expect(sheet.getByText('Your portals had 6 in the last 4 weeks.')).toBeVisible()
    // No groups: no group choice.
    await expect(sheet.queryByRole('radio', { name: /portal group/u })).toBeNull()
  },
}

/** Picks a choice and goes on. */
async function choose(sheet: Sheet, name: RegExp) {
  await userEvent.click(sheet.getByRole('radio', { name }))
  await userEvent.click(sheet.getByRole('button', { name: 'Next' }))
}

/** M-9, M-10, M-12: one portal, its own usual, and 22 set as recommended. */
export const OnePortal: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for one portal/u)
    await expect(sheet.getByText('Which portal?')).toBeVisible()
    await choose(sheet, /^Reception/u)
    await expect(sheet.getByText('Reception · December')).toBeVisible()
    await expect(sheet.getByText('Starts on Dec 1.')).toBeVisible()
    await expect(sheet.getByRole('spinbutton')).toHaveValue('22')
    await expect(sheet.getByRole('spinbutton')).toHaveFocus()
    await expect(sheet.getByRole('radio', { name: /^22 · a bit more/u })).toBeChecked()
    for (const label of ['20 · your usual', '24 · stretch']) {
      await expect(
        sheet.getByRole('radio', { name: (name) => name.startsWith(label) }),
      ).toBeVisible()
    }
    await userEvent.click(sheet.getByRole('button', { name: 'Set 22 for December' }))
    await expect(addOneMock).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        subject: { kind: 'portal', portalId: ADD_IDS.RECEPTION },
        metric: 'portal_rating_count',
        targetValue: 22,
        startMonth: '2026-12',
        targetSource: 'recommended',
      },
    })
    await expectToast('Reception goal set: 22 private ratings for December')
    await expect(onAddedMock).toHaveBeenCalledOnce()
    await expect(onAddedMock).toHaveBeenCalledWith([`portal:${ADD_IDS.RECEPTION}`])
    await waitFor(() =>
      expect(
        within(document.body).queryByRole('dialog', { name: 'Add a portal goal' }),
      ).toBeNull(),
    )
  },
}

/** The same on a 320 px phone: a full-screen sheet, and Back leads to the portals. */
export const Phone320: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-add', 'sheet')
    await choose(inSheet, /^A goal for one portal/u)
    await choose(inSheet, /^Spa/u)
    await expect(inSheet.getByText('Spa · December')).toBeVisible()
    await expect(
      inSheet.getByRole('button', { name: 'Set 10 for December' }),
    ).toBeVisible()
    await userEvent.click(inSheet.getByRole('button', { name: 'Back' }))
    await expect(inSheet.getByRole('radio', { name: /^Spa/u })).toBeChecked()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** M-11, M-12: each portal; Spa is new and unticked, so 2 goals are sent. */
export const EachPortal: Story = {
  args: { options: ADD_EACH_OCT_23 },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for each portal/u)
    const rows = within(sheet.getByRole('list', { name: 'Portals' })).getAllByRole(
      'checkbox',
    )
    // In the read's name order, never by number.
    await expect(rows.map((row) => row.getAttribute('id') ?? '')).toEqual(
      [ADD_IDS.RECEPTION, ADD_IDS.RESTAURANT, ADD_IDS.SPA].map(
        (id) => `portal-goal-each-${id}`,
      ),
    )
    await expect(sheet.getByRole('checkbox', { name: 'Reception' })).toBeChecked()
    await expect(sheet.getByRole('checkbox', { name: 'Spa' })).not.toBeChecked()
    await expect(sheet.getByText('New · ready Oct 29')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Set 2 goals' }))
    await expect(addEachMock).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        startMonth: '2026-11',
        items: [
          { portalId: ADD_IDS.RECEPTION, targetValue: 26, targetSource: 'recommended' },
          { portalId: ADD_IDS.RESTAURANT, targetValue: 12, targetSource: 'recommended' },
        ],
      },
    })
    await expectToast('2 portal goals set')
  },
}

/** M-13: a row the save could not keep says so; the sheet stays for it. */
export const EachPortalRowFailed: Story = {
  args: { options: ADD_EACH_OCT_23 },
  play: async ({ canvasElement }) => {
    addEachMock.mockImplementationOnce(async ({ data }) => ({
      outcomes: data.items.map(({ portalId }) => ({
        portalId,
        saved: portalId !== ADD_IDS.RESTAURANT,
      })),
    }))
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for each portal/u)
    await userEvent.click(sheet.getByRole('button', { name: 'Set 2 goals' }))
    await expect(await sheet.findByText('Not saved, try again')).toBeVisible()
    await expectToast('1 portal goal set')
    // Only the row that was kept has a goal to read again.
    await expect(onAddedMock).toHaveBeenCalledOnce()
    await expect(onAddedMock).toHaveBeenCalledWith([`portal:${ADD_IDS.RECEPTION}`])
    await expect(
      sheet.getByRole('button', { name: 'Raise Reception to 27' }),
    ).toBeVisible()
  },
}

/** M-5: a group's own number, from its members' usual. */
export const Group: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for a portal group/u)
    await expect(sheet.getByText('Which group?')).toBeVisible()
    await choose(sheet, /^Rooms/u)
    await expect(sheet.getByText('Rooms · December')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Set 35 for December' }))
    await expect(addOneMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: { kind: 'portal_group', portalGroupId: ADD_IDS.ROOMS },
        targetValue: 35,
        targetSource: 'recommended',
      }),
    })
    await expectToast('Rooms goal set: 35 private ratings for December')
    // The group page's own goal card is read again with the Portal-goal reads.
    await expect(onAddedMock).toHaveBeenCalledOnce()
    await expect(onAddedMock).toHaveBeenCalledWith([`portal_group:${ADD_IDS.ROOMS}`])
  },
}

/** M-14: the average's box starts empty; 4.5 typed is the manager's own. */
export const Average: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^Average private rating/u)
    await expect(sheet.getByRole('spinbutton')).toHaveValue('')
    await expect(sheet.getByText('Needs 10 private ratings a month.')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await userEvent.type(sheet.getByRole('spinbutton'), '4.5')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 4.5 for December' }))
    await expect(addOneMock).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        subject: { kind: 'property' },
        metric: 'portal_rating_average',
        targetValue: 4.5,
        startMonth: '2026-12',
        targetSource: 'own',
      },
    })
    await expectToast('Average private rating goal set: 4.5 for December')
  },
}

/** An old link's address opens on its portal, already picked. */
export const OldLinkOpensOnAPortal: Story = {
  args: { opening: { step: 'portal', subject: `portal:${ADD_IDS.SPA}` } },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await expect(sheet.getByText('Which portal?')).toBeVisible()
    await expect(sheet.getByRole('radio', { name: /^Spa/u })).toBeChecked()
    await expect(sheet.getByRole('radio', { name: /^Spa/u })).toHaveFocus()
    await userEvent.click(sheet.getByRole('button', { name: 'Back' }))
    await expect(sheet.getByText('What do you want to add?')).toBeVisible()
  },
}

/** M-9: a closed card says "Has a goal" and links to the goal that holds it. */
async function expectHeld(
  sheet: Sheet,
  radio: RegExp,
  goal: Readonly<{ name: string; programId: string }>,
) {
  await expect(sheet.getByRole('radio', { name: radio })).toBeDisabled()
  await expect(sheet.getByText('Has a goal')).toBeVisible()
  await expect(sheet.getByRole('link', { name: goal.name })).toHaveAttribute(
    'href',
    `/properties/${PROPERTY_ID}/goals/${goal.programId}`,
  )
}

const RECEPTION_GOAL = {
  name: 'Reception · Private ratings',
  programId: 'c0000000-0000-4000-8000-000000000001',
}

/** M-9: a portal that has a goal is closed, with a link to that goal. */
export const PortalHasAGoal: Story = {
  args: { options: ADD_RECEPTION_HELD },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for one portal/u)
    await expectHeld(sheet, /^Reception/u, RECEPTION_GOAL)
  },
}

/**
 * The read again after a refusal: the read now finds Reception with a goal, so
 * its number step goes back to the list, where its row says so.
 */
function ReadAgainHarness() {
  const [options, setOptions] = useState<PortalGoalAddOptions>(ADD_EACH_OCT_23)
  return (
    <Harness
      options={options}
      onAdded={async (subjects) => {
        await onAddedMock(subjects)
        setOptions(ADD_RECEPTION_HELD)
      }}
    />
  )
}

/** M-9 after a race: Reception was taken while its number step was open. */
export const PortalTakenAMomentAgo: Story = {
  render: () => <ReadAgainHarness />,
  play: async ({ canvasElement }) => {
    addOneMock.mockImplementationOnce(async () => {
      throw refusal('subject_has_goal')
    })
    const { in: sheet } = await openSheet(canvasElement)
    await choose(sheet, /^A goal for one portal/u)
    await choose(sheet, /^Reception/u)
    await userEvent.click(sheet.getByRole('button', { name: 'Set 26 for November' }))
    await expect(
      await sheet.findByText('A subject you chose already has a goal for this measure.'),
    ).toBeVisible()
    await expect(onAddedMock).toHaveBeenCalledOnce()
    await expect(onAddedMock).toHaveBeenCalledWith([])
    await expect(await sheet.findByText('Which portal?')).toBeVisible()
    await expectHeld(sheet, /^Reception/u, RECEPTION_GOAL)
    await expect(sheet.queryByRole('button', { name: /^Set /u })).toBeNull()
    await expect(sheet.getByRole('button', { name: 'Next' })).toBeDisabled()
  },
}

const AVERAGE_GOAL = {
  name: 'Average private rating',
  programId: 'c0000000-0000-4000-8000-000000000002',
}

/** M-9 on the choice: an average that has a goal is closed, with a link to it. */
export const AverageHasAGoal: Story = {
  args: {
    options: {
      ...ADD_SEAVIEW,
      average: { available: true, last4Weeks: 40, heldBy: AVERAGE_GOAL },
    },
  },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await expectHeld(sheet, /^Average private rating/u, AVERAGE_GOAL)
  },
}

/** The M-rule: one live portal and 6 ratings in 4 weeks offer nothing, so no door. */
export const OnePortalNoMoreGoals: Story = {
  args: { options: ADD_NOTHING },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Add a portal goal' }),
    ).toBeNull()
  },
}
