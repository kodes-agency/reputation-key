// The Monthly portal goal's set sheet under a manager's hands (PLAN PG-10):
// opened on the recommended 40 for November, a step to an own number and the
// way back, a number typed far from the usual, the rest of October, an own
// number in the first weeks (the box starts empty), scans instead, "How we
// worked this out", a set on its way, a goal set a moment ago elsewhere, the
// month turning, a narrow phone (with a note), and a five-figure number. On
// Seaview's Oct 23 (goldens G1, G2) unless named. Then the sheet that changes
// the goal (PLAN PG-14), on Nov 22 with November at 40 and 23 so far: from
// next month, now (below pace), on the last day, scans instead (from next
// month only), a month found ended, the month turned under a change from the
// next month, a goal changed meanwhile, a goal stopped meanwhile, at 320, 390,
// 820 and 1440 px and on the light theme; and a stopped goal's way to the next
// one. The
// Storybook Vitest project compiles no Tailwind, so the plays assert words,
// roles, focus and what each command sends.
import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from '#/components/ui/button'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type {
  PortalGoalCardView,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { SHEET_NOVEMBER_22 } from './portal-goal-change.stories.fixtures'
import {
  CARD_LAST_DAY,
  CARD_LAST_MONTH_UPDATING,
  CARD_RUNNING,
} from './portal-goal-running.stories.fixtures'
import { PortalGoalSheet, type PortalGoalSheetProps } from './portal-goal-sheet'
import {
  SEAVIEW,
  SHEET_FIRST_WEEKS,
  SHEET_READY,
  SHEET_SCANS_ONLY,
} from './portal-goal.stories.fixtures'

type Commands = PortalGoalSheetProps['commands']

const setMock = fn<Commands['setMonthlyPortalGoalFn']>(async () => ({
  programId: 'program-monthly',
}))
const onSetMock = fn<Commands['onSet']>(async () => undefined)
const onSettledMock = fn<PortalGoalSheetProps['onSettled']>()
const onOpenChangeMock = fn<PortalGoalSheetProps['onOpenChange']>()
const changeNowMock = fn<Commands['changeMonthlyPortalGoalNowFn']>(async () => ({
  changed: true,
}))
const reviseMock = fn<Commands['reviseMonthlyPortalGoalFn']>(async () => ({
  programId: 'program-monthly',
}))

/** The two changes, which a story that only sets never sends. */
const CHANGES = {
  changeMonthlyPortalGoalNowFn: changeNowMock,
  reviseMonthlyPortalGoalFn: reviseMock,
} satisfies Partial<Commands>

const refusal = (code: string) =>
  new ServerFunctionError('GoalProgramError', code, code, 409)

type HarnessProps = Pick<PortalGoalSheetProps, 'facts' | 'intent'> &
  Partial<Pick<PortalGoalSheetProps, 'commands' | 'goal' | 'now' | 'canSwitch'>> &
  Readonly<{
    /** The card read again after F-1, F-2 or F-4, which the sheet opens afresh on. */
    latest?: Readonly<{ goal: PortalGoalSheetProps['goal']; facts: PortalGoalSheetFacts }>
  }>

type Shown = Readonly<{
  goal: PortalGoalSheetProps['goal']
  facts: PortalGoalSheetFacts
  notice: unknown
}>

/**
 * A page with one door the sheet opens from: a fresh sheet for every opening,
 * closed when a goal is set or changed, and the focus handed back to the door
 * as the page's host does. A change refused as behind the goal (F-1, F-2,
 * F-4) opens afresh on the card read again (`latest`), still saying why, as
 * the host does.
 */
function Harness({
  facts,
  intent,
  commands,
  goal,
  latest,
  now,
  canSwitch,
}: HarnessProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const [shown, setShown] = useState<Shown>({ goal, facts, notice: null })
  const door = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={door}
        onClick={() => {
          setOpen(true)
          setKey((last) => last + 1)
          setShown({ goal, facts, notice: null })
        }}
      >
        Open the sheet
      </Button>
      <PortalGoalSheet
        key={key}
        goal={shown.goal}
        notice={shown.notice}
        onBehind={(notice) => {
          setShown({ goal: latest?.goal ?? goal, facts: latest?.facts ?? facts, notice })
          setKey((last) => last + 1)
        }}
        now={now}
        canSwitch={canSwitch}
        open={open}
        onOpenChange={(next) => {
          onOpenChangeMock(next)
          setOpen(next)
        }}
        onSettled={() => {
          onSettledMock()
          setOpen(false)
        }}
        propertyId={SEAVIEW.propertyId}
        facts={shown.facts}
        intent={intent}
        commands={
          commands ?? { ...CHANGES, setMonthlyPortalGoalFn: setMock, onSet: onSetMock }
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!open) door.current?.focus()
        }}
      />
    </>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Goals/PortalGoalSheet',
  component: Harness,
  args: { facts: SHEET_READY, intent: { measure: 'portal_rating_count' } },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story; a Toaster that mounts replays what still shows.
    toast.dismiss()
    for (const mock of [
      setMock,
      onSetMock,
      onSettledMock,
      onOpenChangeMock,
      changeNowMock,
      reviseMock,
    ]) {
      mock.mockClear()
    }
  },
}

export default meta
type Story = StoryObj<typeof meta>

const ASK_EVERY_GUEST =
  'Ask every guest, not only happy ones. Low and high ratings count the same.'
const RECOMMENDED = 'Recommended · a bit above your usual over the last 2 weeks'

/** Opens the sheet from its door and waits for its title. */
async function openSheet(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open the sheet' }),
  )
  const sheet = await within(document.body).findByRole('dialog', {
    name: 'Monthly portal goal',
  })
  return { sheet, in: within(sheet) }
}

type Sheet = Awaited<ReturnType<typeof openSheet>>['in']

const box = (sheet: Sheet) => sheet.getByRole('spinbutton')

/** The region the notes are said in. */
const notesRegion = () => document.body.querySelector('[data-slot="portal-goal-notes"]')

/** The line that says what the number is, as one text. */
const statusLine = (): string =>
  document.body
    .querySelector('[data-slot="portal-goal-status"]')
    ?.textContent?.replace(/·/gu, ' · ')
    .replace(/\s+/gu, ' ')
    .trim() ?? ''

/** A toast in the page, once it has faded in. */
async function expectToast(text: string) {
  const shown = await within(document.body).findByText(text)
  await waitFor(() => expect(shown).toBeVisible())
}

/** Done: it says so, the card is read again, and the sheet has closed. */
async function expectSettled(text: string) {
  await expectToast(text)
  await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
  await expect(onSetMock).toHaveBeenCalledOnce()
  await waitFor(() =>
    expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
  )
}

async function expectRecommendedNovember(sheet: Sheet) {
  await expect(sheet.getByText('Starts on Nov 1.')).toBeVisible()
  await expect(sheet.getByRole('radio', { name: 'November' })).toBeChecked()
  await expect(box(sheet)).toHaveValue('40')
  await expect(box(sheet)).toHaveAccessibleName('November private ratings')
  await expect(box(sheet)).toHaveAttribute('aria-valuetext', '40 private ratings')
  await expect(sheet.getByRole('radio', { name: /^40 · a bit more/u })).toBeChecked()
  await expect(
    sheet.getByRole('radio', { name: '40 · a bit more Recommended' }),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Lower to 35' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Raise to 45' })).toBeVisible()
  await expect(statusLine()).toBe(RECOMMENDED)
  await expect(sheet.getByText(ASK_EVERY_GUEST)).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Set 40 for November' })).toBeEnabled()
}

/** Opens on the recommended 40 with the focus in the box; Set sends it as recommended. */
export const SetRecommended: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await waitFor(() => expect(box(sheet)).toHaveFocus())
    await expectRecommendedNovember(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Set 40 for November' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        metric: 'portal_rating_count',
        targetValue: 40,
        startMonth: '2026-11',
        targetSource: 'recommended',
      },
    })
    await expectSettled('November goal set: 40 private ratings')
  },
}

export const SetRecommendedOnANarrowPhone: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'sheet')
    await expectRecommendedNovember(inSheet)
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const SetRecommendedOnAPhone: Story = {
  ...SetRecommendedOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const SetRecommendedOnATablet: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'dialog')
    await expectRecommendedNovember(inSheet)
  },
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const SetRecommendedOnADesktop: Story = {
  ...SetRecommendedOnATablet,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const SetRecommendedLight: Story = {
  ...SetRecommendedOnATablet,
  parameters: { theme: 'light' },
}

/** + moves to 45, an own number; the link goes back to 40, recommended. */
export const StepOwnNumber: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.click(sheet.getByRole('button', { name: 'Raise to 45' }))
    await expect(box(sheet)).toHaveValue('45')
    await expect(sheet.getByRole('radio', { name: '45 · stretch' })).toBeChecked()
    await expect(statusLine()).toBe('Your own number · Back to 40, recommended')
    await expect(sheet.getByRole('button', { name: 'Raise to 50' })).toBeVisible()
    // The keyboard steps along the same grid.
    await userEvent.click(box(sheet))
    await userEvent.keyboard('{ArrowUp}')
    await expect(box(sheet)).toHaveValue('50')
    await expect(sheet.getByRole('radio', { name: /stretch/u })).not.toBeChecked()
    // While the box has the focus its value text says the number; the line is quiet.
    await expect(
      document.querySelector('[data-slot="portal-goal-status"]'),
    ).toHaveAttribute('aria-live', 'off')
    await userEvent.click(sheet.getByRole('button', { name: 'Back to 40, recommended' }))
    await expect(box(sheet)).toHaveValue('40')
    await expect(statusLine()).toBe(RECOMMENDED)
    await userEvent.click(sheet.getByRole('button', { name: 'Set 40 for November' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetValue: 40, targetSource: 'recommended' }),
    })
  },
}

/** 120 typed: about 4 times the usual of 34.29, and sent as the manager's own. */
export const TypeNumber: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.clear(box(sheet))
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await userEvent.type(box(sheet), '120')
    await expect(sheet.getByText('That is about 4 times your usual.')).toBeVisible()
    // The note is said as it appears, the box's focus or not.
    await expect(notesRegion()).toHaveAttribute('aria-live', 'polite')
    await expect(notesRegion()).toHaveTextContent('That is about 4 times your usual.')
    // No suggestion holds it, and the line offers the way back.
    await expect(sheet.queryByRole('radio', { checked: true, name: /·/u })).toBeNull()
    await expect(statusLine()).toBe('Your own number · Back to 40, recommended')
    // Enter writes the number; it sends nothing.
    await userEvent.type(box(sheet), '{Enter}')
    await expect(box(sheet)).toHaveValue('120')
    await expect(setMock).not.toHaveBeenCalled()
    await userEvent.click(sheet.getByRole('button', { name: 'Set 120 for November' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetValue: 120, targetSource: 'own' }),
    })
  },
}

/** A 0 is no number a goal takes: the box is invalid and Set waits. */
export const ZeroIsInvalid: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.clear(box(sheet))
    await userEvent.type(box(sheet), '0')
    await expect(box(sheet)).toHaveAttribute('aria-invalid', 'true')
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await expect(sheet.getByRole('button', { name: 'Lower' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** October: it counts from Oct 1 with the 12 that already count, 24 recommended. */
export const SetCurrentMonth: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.click(sheet.getByRole('radio', { name: 'October' }))
    await expect(sheet.getByText('Counts from Oct 1 · 12 already count.')).toBeVisible()
    await expect(box(sheet)).toHaveValue('24')
    await expect(box(sheet)).toHaveAccessibleName('October private ratings')
    for (const name of ['23 · your usual', /^24 · a bit more/u, '25 · stretch']) {
      await expect(sheet.getByRole('radio', { name })).toBeVisible()
    }
    await userEvent.click(sheet.getByRole('button', { name: 'Set 24 for October' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startMonth: '2026-10',
        targetValue: 24,
        targetSource: 'recommended',
      }),
    })
    await expectToast('October goal set: 24 private ratings')
  },
}

/** The first weeks: no number yet, so the box starts empty; 12 typed sets 12 for October. */
export const OwnFirstWeeks: Story = {
  args: { facts: SHEET_FIRST_WEEKS },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await waitFor(() => expect(box(sheet)).toHaveFocus())
    await expect(box(sheet)).toHaveValue('')
    await expect(sheet.getByText('Counts from Oct 1 · 8 already count.')).toBeVisible()
    await expect(statusLine()).toBe(
      'No recommendation yet. Your number is ready on Oct 23.',
    )
    await expect(
      sheet.queryByRole('radiogroup', { name: 'Suggested numbers' }),
    ).toBeNull()
    await expect(
      sheet.queryByRole('button', { name: 'How we worked this out' }),
    ).toBeNull()
    await expect(sheet.getByText(ASK_EVERY_GUEST)).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await userEvent.type(box(sheet), '12')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 12 for October' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        metric: 'portal_rating_count',
        targetValue: 12,
        startMonth: '2026-10',
        targetSource: 'own',
      },
    })
  },
}

export const OwnFirstWeeksOnANarrowPhone: Story = {
  ...OwnFirstWeeks,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Scans instead: their unit, their three numbers, and no ask-every-guest line. */
export const CountScansInstead: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.click(sheet.getByRole('button', { name: 'Count scans instead' }))
    await expect(box(sheet)).toHaveValue('55')
    await expect(box(sheet)).toHaveAccessibleName('November scans')
    await expect(box(sheet)).toHaveAttribute('aria-valuetext', '55 scans')
    await expect(sheet.getByRole('radio', { name: /^55 · a bit more/u })).toBeChecked()
    await expect(sheet.queryByText(ASK_EVERY_GUEST)).toBeNull()
    await expect(
      sheet.getByRole('button', { name: 'Count private ratings instead' }),
    ).toBeVisible()
    await userEvent.click(
      sheet.getByRole('button', { name: 'Set 55 scans for November' }),
    )
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metric: 'qualified_scans',
        targetValue: 55,
        targetSource: 'recommended',
      }),
    })
    await expectToast('November goal set: 55 scans')
  },
}

/** The sums behind the number open on request; Escape closes them, not the sheet. */
export const HowWeWorkedThisOut: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    const trigger = inSheet.getByRole('button', { name: 'How we worked this out' })
    await userEvent.click(trigger)
    const popover = await within(document.body).findByRole('dialog', {
      name: 'How we worked this out',
    })
    await expect(
      within(popover).getByText(
        'At that pace, a 30-day month gets about 34: your usual. The recommendation is a bit more, rounded up: 40.',
      ),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(popover).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(sheet).toBeInTheDocument()
  },
}

/** While Set is on its way the sheet is busy: Escape is refused and it is sent once. */
export const Pending: Story = {
  args: {
    commands: {
      ...CHANGES,
      setMonthlyPortalGoalFn: fn(() => new Promise<never>(() => undefined)),
      onSet: onSetMock,
    },
  },
  play: async ({ canvasElement, args }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await userEvent.dblClick(inSheet.getByRole('button', { name: 'Set 40 for November' }))
    const busy = await inSheet.findByRole('button', { name: 'Saving…' })
    await expect(busy).toBeDisabled()
    await expect(busy).toHaveAttribute('aria-busy', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(sheet).toBeInTheDocument()
    await expect(onOpenChangeMock).not.toHaveBeenCalledWith(false)
    await expect(args.commands?.setMonthlyPortalGoalFn).toHaveBeenCalledOnce()
    // The number sent holds still: the box is read-only and − and + wait.
    await expect(box(inSheet)).toHaveAttribute('readonly')
    for (const name of ['Lower to 35', 'Raise to 45']) {
      const step = inSheet.getByRole('button', { name })
      await expect(step).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(step)
    }
    await userEvent.click(box(inSheet))
    await userEvent.keyboard('{ArrowUp}')
    await expect(box(inSheet)).toHaveValue('40')
  },
}

/** F-3: a goal was set a moment ago elsewhere. The card is read again, the sheet closes, a toast says why. */
export const RefusedSetRace: Story = {
  args: {
    commands: {
      ...CHANGES,
      setMonthlyPortalGoalFn: fn(async () => {
        throw refusal('subject_has_goal')
      }),
      onSet: onSetMock,
    },
  },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.click(sheet.getByRole('button', { name: 'Set 40 for November' }))
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await expectToast('A monthly portal goal was set a moment ago. Here is the latest.')
  },
}

/** F-4: the month turned while the sheet was open. The banner says so, and the card is read again. */
export const RefusedMonthTurned: Story = {
  args: {
    commands: {
      ...CHANGES,
      setMonthlyPortalGoalFn: fn(async () => {
        throw refusal('start_month_changed')
      }),
      onSet: onSetMock,
    },
  },
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await userEvent.click(inSheet.getByRole('button', { name: 'Set 40 for November' }))
    await expect(
      await inSheet.findByText('The month has changed. Check the start and save again.'),
    ).toBeVisible()
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await expect(onSettledMock).not.toHaveBeenCalled()
    await expect(sheet).toBeInTheDocument()
  },
}

/**
 * 320 px: the full-screen sheet, with the long "Set 55 scans for November".
 * That its footer stays pinned and the label wraps is the screenshot pass's to
 * show (320 × 568, scrolled): this project compiles no Tailwind, so a play
 * measuring the sheet would measure nothing.
 */
export const Phone320: Story = {
  args: { facts: SHEET_SCANS_ONLY, intent: { measure: 'qualified_scans' } },
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'sheet')
    await expect(
      inSheet.getByRole('button', { name: 'Set 55 scans for November' }),
    ).toBeVisible()
    await expect(inSheet.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** 320 px, private ratings with a note: the longest sheet, for the pinned footer's screenshot. */
export const NoteOnANarrowPhone: Story = {
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'sheet')
    await userEvent.clear(box(inSheet))
    await userEvent.type(box(inSheet), '120')
    await expect(notesRegion()).toHaveTextContent('That is about 4 times your usual.')
    await expect(inSheet.getByText(ASK_EVERY_GUEST)).toBeVisible()
    await expect(
      inSheet.getByRole('button', { name: 'Set 120 for November' }),
    ).toBeEnabled()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** A five-figure number: written plainly in the box, grouped where it is said. */
export const TypeALongNumber: Story = {
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await userEvent.clear(box(sheet))
    await userEvent.type(box(sheet), '12,000{Enter}')
    await expect(box(sheet)).toHaveValue('12000')
    await expect(box(sheet)).toHaveAttribute('aria-valuetext', '12,000 private ratings')
    await expect(sheet.getByText('That is about 350 times your usual.')).toBeVisible()
    await expect(
      sheet.getByRole('button', { name: 'Set 12,000 for November' }),
    ).toBeEnabled()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

// ─── Changing the goal (PLAN PG-14) ────────────────────────────────────────

const goalOf = (card: PortalGoalCardView) => {
  if (card.state !== 'goal') throw new Error('expected a goal')
  return card.goal
}

const RUNNING_GOAL = goalOf(CARD_RUNNING)
const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

/** The change sheet on Nov 22, opened by "Change number". */
const CHANGING = {
  facts: SHEET_NOVEMBER_22,
  intent: { mode: 'change', measure: 'portal_rating_count' },
  goal: RUNNING_GOAL,
  now: NOV_22,
} satisfies Partial<HarnessProps>

const CHANGE_RECOMMENDED = 'Recommended · a bit above your usual over the last 4 weeks'

/** Opens the change sheet from its door and waits for its title. */
async function openChange(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open the sheet' }),
  )
  const sheet = await within(document.body).findByRole('dialog', {
    name: 'Change your monthly portal goal',
  })
  return { sheet, in: within(sheet) }
}

async function typeNumber(sheet: Sheet, text: string) {
  await userEvent.clear(box(sheet))
  await userEvent.type(box(sheet), text)
}

/** The sheet's commands, with the changes a story refuses or answers its own way. */
const changeCommands = (changes: Partial<Commands>): Commands => ({
  ...CHANGES,
  setMonthlyPortalGoalFn: setMock,
  onSet: onSetMock,
  ...changes,
})

/** From the change sheet opened on Nov 22: 45 from December, sent. */
async function sendFromDecember(canvasElement: HTMLElement) {
  const { in: sheet } = await openChange(canvasElement)
  await typeNumber(sheet, '45')
  await userEvent.click(sheet.getByRole('button', { name: 'Set 45 from December' }))
}

/** The change sheet opened afresh on the latest, once it says why. */
async function reopenedSaying(text: string) {
  const fresh = within(
    await within(document.body).findByRole('dialog', {
      name: 'Change your monthly portal goal',
    }),
  )
  await expect(await fresh.findByText(text)).toBeVisible()
  return fresh
}

/** After the 20th it opens on December: 45 from December goes through the revision. */
export const ChangeNextMonth: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await waitFor(() => expect(box(sheet)).toHaveFocus())
    await expect(sheet.getByRole('radio', { name: 'From Dec 1' })).toBeChecked()
    await expect(sheet.getByText('November stays at 40.')).toBeVisible()
    await expect(box(sheet)).toHaveValue('40')
    // No suggested numbers to pick: only what the number is.
    await expect(
      sheet.queryByRole('radiogroup', { name: 'Suggested numbers' }),
    ).toBeNull()
    await expect(
      sheet.getByRole('button', { name: 'Set 40 from December' }),
    ).toBeDisabled()
    await typeNumber(sheet, '45')
    await expect(statusLine()).toBe(CHANGE_RECOMMENDED)
    await userEvent.click(sheet.getByRole('button', { name: 'Add a note' }))
    const note = sheet.getByRole('textbox', { name: 'Note' })
    await waitFor(() => expect(note).toHaveFocus())
    await userEvent.type(note, 'Winter opening hours')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 45 from December' }))
    await expect(reviseMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-monthly',
        targetValue: 45,
        note: 'Winter opening hours',
        targetSource: 'recommended',
        metric: 'portal_rating_count',
        expectedVersion: 1,
        startMonth: '2026-12',
      },
    })
    await expect(changeNowMock).not.toHaveBeenCalled()
    await expectToast('From December: 45 private ratings')
    await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
    await expect(onSetMock).toHaveBeenCalledOnce()
  },
}

/** "November, now": 45 judges November too, and 23 so far starts it below pace. */
export const ChangeNowBelowPace: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await userEvent.click(sheet.getByRole('radio', { name: 'November, now' }))
    await expect(
      sheet.getByText(
        'November is judged against the new number, and so are the months after it.',
      ),
    ).toBeVisible()
    await typeNumber(sheet, '45')
    await expect(notesRegion()).toHaveTextContent('At 23 so far, 45 starts below pace.')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 45 for November' }))
    await expect(changeNowMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-monthly',
        targetValue: 45,
        targetSource: 'own',
        month: '2026-11',
        expectedTarget: 40,
        expectedVersion: 1,
        expectedFollowingMonth: '2026-12',
      },
    })
    await expectToast('November goal: 45 private ratings')
    await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
  },
}

/** Nov 30, the last day: a month locks only once it has ended, so both months are offered. */
export const ChangeLastDay: Story = {
  args: {
    ...CHANGING,
    goal: goalOf(CARD_LAST_DAY),
    now: new Date('2026-11-30T20:00:00.000Z'),
  },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await expect(sheet.getByRole('radio', { name: 'November, now' })).toBeEnabled()
    await expect(sheet.getByRole('radio', { name: 'From Dec 1' })).toBeChecked()
    await userEvent.click(sheet.getByRole('radio', { name: 'November, now' }))
    await typeNumber(sheet, '30')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 30 for November' }))
    await expect(changeNowMock.mock.calls[0]?.[0].data).toMatchObject({
      month: '2026-11',
      targetValue: 30,
    })
  },
}

/**
 * A Portal's goal whose Portal already holds a scans goal from December (PLAN
 * PG-21): its change sheet offers no "Count scans instead", which would be
 * refused.
 */
export const ChangeScansHeld: Story = {
  args: { ...CHANGING, canSwitch: false },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await expect(box(sheet)).toHaveValue('40')
    await expect(sheet.queryByRole('button', { name: 'Count scans instead' })).toBeNull()
  },
}

/** Scans instead: only from December, and November keeps counting private ratings. */
export const ChangeScansForcesNext: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await userEvent.click(sheet.getByRole('radio', { name: 'November, now' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Count scans instead' }))
    await expect(sheet.getByRole('radio', { name: 'November, now' })).toBeDisabled()
    await expect(sheet.getByRole('radio', { name: 'From Dec 1' })).toBeChecked()
    await expect(
      sheet.getByText('November keeps counting private ratings.'),
    ).toBeVisible()
    await expect(box(sheet)).toHaveValue('55')
    await expect(sheet.queryByText(ASK_EVERY_GUEST)).toBeNull()
    await userEvent.click(
      sheet.getByRole('button', { name: 'Set 55 scans from December' }),
    )
    await expect(reviseMock.mock.calls[0]?.[0].data).toMatchObject({
      metric: 'qualified_scans',
      targetValue: 55,
      targetSource: 'recommended',
    })
    await expectToast('From December: 55 scans')
  },
}

/** The card as it is read on Dec 1, once December runs. */
const READ_ON_DECEMBER_1 = {
  goal: goalOf(CARD_LAST_MONTH_UPDATING),
  facts:
    CARD_LAST_MONTH_UPDATING.state === 'goal'
      ? CARD_LAST_MONTH_UPDATING.sheet
      : SHEET_NOVEMBER_22,
}

/**
 * F-2: November ended while the sheet was open on its last day. The card is
 * read again and the sheet opens afresh on it, on "December, now", saying why.
 */
export const RefusedMonthEnded: Story = {
  args: {
    ...CHANGING,
    goal: goalOf(CARD_LAST_DAY),
    now: new Date('2026-11-30T20:00:00.000Z'),
    latest: READ_ON_DECEMBER_1,
    commands: changeCommands({
      changeMonthlyPortalGoalNowFn: fn<Commands['changeMonthlyPortalGoalNowFn']>(
        async ({ data }) => {
          if (data.month === '2026-11') throw refusal('month_locked')
          return { changed: true }
        },
      ),
    }),
  },
  play: async ({ canvasElement, args }) => {
    const { in: sheet } = await openChange(canvasElement)
    await userEvent.click(sheet.getByRole('radio', { name: 'November, now' }))
    await typeNumber(sheet, '45')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 45 for November' }))
    const fresh = await reopenedSaying(
      'November has ended. Set the number for December instead.',
    )
    // Opened afresh on the latest read: December runs, at 40.
    await waitFor(() =>
      expect(fresh.getByRole('radio', { name: 'December, now' })).toBeChecked(),
    )
    await expect(fresh.getByRole('radio', { name: 'From Jan 1' })).toBeVisible()
    await expect(
      fresh.getByText(
        'December is judged against the new number, and so are the months after it.',
      ),
    ).toBeVisible()
    await expect(box(fresh)).toHaveValue('40')
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await typeNumber(fresh, '45')
    await userEvent.click(fresh.getByRole('button', { name: 'Set 45 for December' }))
    await waitFor(() =>
      expect(args.commands?.changeMonthlyPortalGoalNowFn).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          month: '2026-12',
          targetValue: 45,
          expectedFollowingMonth: '2027-01',
        }),
      }),
    )
    await expectToast('December goal: 45 private ratings')
  },
}

/**
 * F-4: the month turned while "From Dec 1" was open, so the change would start
 * in January. It is refused, not moved on; the sheet opens afresh on the latest.
 */
export const RefusedStartMonthChanged: Story = {
  args: {
    ...CHANGING,
    latest: READ_ON_DECEMBER_1,
    commands: changeCommands({
      reviseMonthlyPortalGoalFn: fn<Commands['reviseMonthlyPortalGoalFn']>(
        async ({ data }) => {
          if (data.startMonth === '2026-12') throw refusal('start_month_changed')
          return { programId: 'program-monthly' }
        },
      ),
    }),
  },
  play: async ({ canvasElement }) => {
    await sendFromDecember(canvasElement)
    const fresh = await reopenedSaying(
      'The month has changed. Check the start and save again.',
    )
    await waitFor(() =>
      expect(fresh.getByRole('radio', { name: 'From Jan 1' })).toBeVisible(),
    )
    await expect(fresh.queryByRole('radio', { name: 'From Dec 1' })).toBeNull()
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await expect(onSettledMock).not.toHaveBeenCalled()
  },
}

/** F-5: someone stopped the goal meanwhile. Nothing is left to change: the sheet closes and says so. */
export const RefusedStopped: Story = {
  args: {
    ...CHANGING,
    commands: changeCommands({
      reviseMonthlyPortalGoalFn: fn(async () => {
        throw refusal('invalid_transition')
      }),
    }),
  },
  play: async ({ canvasElement }) => {
    await sendFromDecember(canvasElement)
    await expectSettled('This goal was already stopped. Here is the latest.')
  },
}

/** F-1: someone changed the goal meanwhile. The latest is read, and the sheet opens on it. */
export const RefusedConflict: Story = {
  args: {
    ...CHANGING,
    latest: {
      goal: { ...RUNNING_GOAL, version: 2, target: 50 },
      facts: SHEET_NOVEMBER_22,
    },
    commands: changeCommands({
      // Refused while it is sent against the version the sheet first opened on.
      reviseMonthlyPortalGoalFn: fn<Commands['reviseMonthlyPortalGoalFn']>(
        async ({ data }) => {
          if (data.expectedVersion === 1) throw refusal('revision_conflict')
          return { programId: 'program-monthly' }
        },
      ),
    }),
  },
  play: async ({ canvasElement, args }) => {
    await sendFromDecember(canvasElement)
    const fresh = await reopenedSaying(
      'Someone changed this goal a moment ago. Here is the latest.',
    )
    // Opened afresh on the latest: December is 50 now.
    await waitFor(() => expect(box(fresh)).toHaveValue('50'))
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await typeNumber(fresh, '45')
    await userEvent.click(fresh.getByRole('button', { name: 'Set 45 from December' }))
    await waitFor(() =>
      expect(args.commands?.reviseMonthlyPortalGoalFn).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ targetValue: 45, expectedVersion: 2 }),
      }),
    )
    await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
  },
}

/** 320 px: the full-screen change sheet, its footer and its note. */
export const Change320: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openChange(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'sheet')
    await userEvent.click(inSheet.getByRole('button', { name: 'Add a note' }))
    await expect(inSheet.getByRole('textbox', { name: 'Note' })).toBeVisible()
    await expect(inSheet.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** 390 px: still the full-screen sheet. */
export const ChangeOnAPhone: Story = {
  ...Change320,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

/** From 820 px the change opens as a dialog, with both months and the note. */
export const ChangeOnATablet: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openChange(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'dialog')
    await expect(inSheet.getByRole('radio', { name: 'From Dec 1' })).toBeChecked()
    await expect(inSheet.getByText('November stays at 40.')).toBeVisible()
    await userEvent.click(inSheet.getByRole('button', { name: 'Add a note' }))
    await expect(inSheet.getByRole('textbox', { name: 'Note' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const ChangeOnADesktop: Story = {
  ...ChangeOnATablet,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const ChangeLight: Story = {
  args: CHANGING,
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openChange(canvasElement)
    await expect(sheet.getByText('November stays at 40.')).toBeVisible()
  },
  parameters: { theme: 'light' },
}

/** Stopped in November: "Set a goal from December" opens the set sheet on December alone. */
export const SetFromAStoppedGoal: Story = {
  args: {
    facts: SHEET_NOVEMBER_22,
    intent: { measure: 'portal_rating_count', month: '2026-12' },
  },
  play: async ({ canvasElement }) => {
    const { in: sheet } = await openSheet(canvasElement)
    await expect(sheet.queryByRole('radiogroup', { name: 'Month' })).toBeNull()
    await expect(sheet.getByText('Starts on Dec 1.')).toBeVisible()
    await expect(box(sheet)).toHaveValue('45')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 45 for December' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        metric: 'portal_rating_count',
        targetValue: 45,
        startMonth: '2026-12',
        targetSource: 'recommended',
      },
    })
  },
}
