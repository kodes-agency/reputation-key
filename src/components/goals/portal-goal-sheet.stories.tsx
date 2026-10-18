// The Monthly portal goal's set sheet under a manager's hands (PLAN PG-10):
// opened on the recommended 40 for November, a step to an own number and the
// way back, a number typed far from the usual, the rest of October, an own
// number in the first weeks (the box starts empty), scans instead, "How we
// worked this out", a set on its way, a goal set a moment ago elsewhere, the
// month turning, and a narrow phone. On Seaview's Oct 23 (goldens G1, G2) unless
// named. The Storybook Vitest project compiles no Tailwind, so the plays assert
// words, roles, focus and what Set sends.
import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from '#/components/ui/button'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
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

const refusal = (code: string) =>
  new ServerFunctionError('GoalProgramError', code, code, 409)

type HarnessProps = Pick<PortalGoalSheetProps, 'facts' | 'intent'> &
  Partial<Pick<PortalGoalSheetProps, 'commands'>>

/**
 * A page with one door the sheet opens from: a fresh sheet for every opening,
 * closed when a goal is set, and the focus handed back to the door as the
 * page's host does.
 */
function Harness({ facts, intent, commands }: HarnessProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const door = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={door}
        onClick={() => {
          setOpen(true)
          setKey((last) => last + 1)
        }}
      >
        Open the sheet
      </Button>
      <PortalGoalSheet
        key={key}
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
        facts={facts}
        intent={intent}
        commands={commands ?? { setMonthlyPortalGoalFn: setMock, onSet: onSetMock }}
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
    for (const mock of [setMock, onSetMock, onSettledMock, onOpenChangeMock]) {
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
    await expectToast('November goal set: 40 private ratings')
    await waitFor(() => expect(onSettledMock).toHaveBeenCalledOnce())
    await expect(onSetMock).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
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
  },
}

/** F-3: a goal was set a moment ago elsewhere. The card is read again, the sheet closes, a toast says why. */
export const RefusedSetRace: Story = {
  args: {
    commands: {
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

/** 320 px: the full-screen sheet keeps its footer on screen, and a long Set fits. */
export const Phone320: Story = {
  args: { facts: SHEET_SCANS_ONLY, intent: { measure: 'qualified_scans' } },
  play: async ({ canvasElement }) => {
    const { sheet, in: inSheet } = await openSheet(canvasElement)
    await expect(sheet).toHaveAttribute('data-portal-goal-sheet', 'sheet')
    const set = inSheet.getByRole('button', { name: 'Set 55 scans for November' })
    await expect(set).toBeVisible()
    const button = set.getBoundingClientRect()
    await expect(button.right).toBeLessThanOrEqual(window.innerWidth)
    await expect(button.bottom).toBeLessThanOrEqual(window.innerHeight)
    await expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth)
    await expect(inSheet.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}
