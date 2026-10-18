// A goal's own page on `$goalId` beyond the four the plan names (PLAN PG-21;
// those are in `portal-goal-page.stories.tsx`): the average's "Change number",
// whose sheet changes its level in tenths from December or for November, and
// opens afresh on the latest when someone changed it a moment ago; the average
// set and not yet begun, stopped (its months and changes still there, no
// actions), and a Portal's own average; Reception's goal when Reception already
// holds a scans goal (no "Count scans instead"), and on a phone, where "How this
// goal counts" names Reception; and a goal an older form made for several
// subjects, running (with Stop) and stopped. At 320, 390, 820 and 1440 px and on
// the light theme. The Storybook Vitest project compiles no Tailwind, so the
// plays assert words, roles, the heading outline and the calls.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type { PortalGoalAverageCommands } from './portal-goal-average-page'
import { PortalGoalAveragePage } from './portal-goal-average-page'
import { PortalGoalPage } from './portal-goal-page'
import { SEAVIEW, personName } from './portal-goal-page.stories.fixtures'
import { PortalGoalSeveralPage } from './portal-goal-several-page'
import {
  AVERAGE_RECEPTION,
  AVERAGE_RUNNING,
  AVERAGE_SCHEDULED,
  AVERAGE_STOPPED,
  SEVERAL_RUNNING,
  SEVERAL_STOPPED,
  SINGLE_RECEPTION,
  SINGLE_RECEPTION_SCANS_HELD,
} from './portal-goal-single-page.stories.fixtures'
import {
  singleGoalTitle,
  singleSubjectWords,
  subjectPlace,
} from './portal-goal-single-page-view'

const changeNowMock = fn<PortalGoalAverageCommands['changeMonthlyPortalGoalNowFn']>(
  async () => ({}),
)
const reviseMock = fn<PortalGoalAverageCommands['reviseMonthlyPortalGoalFn']>(
  async () => ({}),
)
const onChangedMock = fn<PortalGoalAverageCommands['onChanged']>(async () => undefined)
const rereadMock = fn<PortalGoalAverageCommands['reread']>(
  async () => AVERAGE_RUNNING.goal,
)
const stopMock = fn(async () => ({ programId: 'program-several' }))
const onStoppedMock = fn(async () => undefined)
const onRefusedMock = fn(async () => undefined)

const commands = {
  changeMonthlyPortalGoalNowFn: changeNowMock,
  reviseMonthlyPortalGoalFn: reviseMock,
  onChanged: onChangedMock,
  reread: rereadMock,
} satisfies PortalGoalAverageCommands
const stop = {
  stopMonthlyPortalGoalFn: stopMock,
  onStopped: onStoppedMock,
  onRefused: onRefusedMock,
}

const meta: Meta<typeof PortalGoalAveragePage> = {
  title: 'Goals/PortalGoalSinglePage',
  component: PortalGoalAveragePage,
  parameters: { layout: 'padded', viewport: { defaultViewport: 'desktopManager' } },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    view: AVERAGE_RUNNING,
    canChange: true,
    canStop: true,
    commands,
    stop,
    personName,
  },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story: no toast here reaches another.
    toast.dismiss()
    for (const mock of [
      changeNowMock,
      reviseMock,
      onChangedMock,
      rereadMock,
      stopMock,
      onStoppedMock,
      onRefusedMock,
    ]) {
      mock.mockClear()
    }
    return () => void toast.dismiss()
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** The page's headings, in document order, as "h2 Changes". */
const outline = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )

function tilesOf(canvasElement: HTMLElement): Canvas {
  const strip = canvasElement.querySelector<HTMLElement>('[data-slot="metric-strip"]')
  if (!strip) throw new Error('expected the tiles')
  return within(strip)
}

function changeTexts(canvas: Canvas): string[] {
  const section = canvas.getByRole('region', { name: 'Changes' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

/** Opens the average's change sheet from "Change number"; its chunk loads first. */
async function openChange(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Change number' }),
  )
  const sheet = await within(document.body).findByRole('dialog', {
    name: 'Change this portal goal',
  })
  return within(sheet)
}

async function typeLevel(sheet: Canvas, text: string) {
  const box = sheet.getByRole('spinbutton')
  await userEvent.clear(box)
  await userEvent.type(box, text)
}

async function expectToast(text: string) {
  const said = await within(document.body).findByText(text)
  await waitFor(() => expect(said).toBeVisible())
}

// ─── The average's change (PLAN PG-21) ─────────────────────────────────────

/** After the 20th it opens on December at 4.5: 4.6 from December is a revision. */
export const AverageChangeFromDecember: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openChange(canvasElement)
    const box = sheet.getByRole('spinbutton')
    await waitFor(() => expect(box).toHaveFocus())
    await expect(sheet.getByRole('radio', { name: 'From Dec 1' })).toBeChecked()
    await expect(sheet.getByText('November stays at 4.5.')).toBeVisible()
    await expect(sheet.getByText('Needs 10 private ratings a month.')).toBeVisible()
    await expect(box).toHaveValue('4.5')
    await expect(
      sheet.getByRole('button', { name: 'Set 4.5 from December' }),
    ).toBeDisabled()
    await typeLevel(sheet, '4.6')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 4.6 from December' }))
    await expect(reviseMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-average',
        targetValue: 4.6,
        targetSource: 'own',
        metric: 'portal_rating_average',
        expectedVersion: 1,
        startMonth: '2026-12',
      },
    })
    await expect(changeNowMock).not.toHaveBeenCalled()
    await expectToast('From December: 4.6 average private rating')
    await waitFor(() => expect(onChangedMock).toHaveBeenCalledOnce())
  },
}

/** "November, now": a tenth up judges November and the months after it. */
export const AverageChangeNow: Story = {
  parameters: { viewport: { defaultViewport: 'tablet' } },
  play: async ({ canvasElement }) => {
    const sheet = await openChange(canvasElement)
    await userEvent.click(sheet.getByRole('radio', { name: 'November, now' }))
    await expect(
      sheet.getByText(
        'November is judged against the new number, and so are the months after it.',
      ),
    ).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Raise to 4.6' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Set 4.6 for November' }))
    await expect(changeNowMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-average',
        targetValue: 4.6,
        targetSource: 'own',
        month: '2026-11',
        expectedTarget: 4.5,
        expectedVersion: 1,
        expectedFollowingMonth: '2026-12',
      },
    })
    await expectToast('November goal: 4.6 average private rating')
  },
}

/** Someone changed it a moment ago: the page is read again and the sheet opens on it. */
export const AverageChangeRefusedConflict: Story = {
  beforeEach: () => {
    reviseMock.mockRejectedValueOnce(
      new ServerFunctionError(
        'GoalProgramError',
        'revision_conflict',
        'revision_conflict',
        409,
      ),
    )
  },
  play: async ({ canvasElement }) => {
    const sheet = await openChange(canvasElement)
    await typeLevel(sheet, '4.7')
    await userEvent.click(sheet.getByRole('button', { name: 'Set 4.7 from December' }))
    await waitFor(() => expect(rereadMock).toHaveBeenCalledOnce())
    const again = within(
      await within(document.body).findByRole('dialog', {
        name: 'Change this portal goal',
      }),
    )
    await expect(
      await again.findByText(
        'Someone changed this goal a moment ago. Here is the latest.',
      ),
    ).toBeVisible()
    // Afresh on the latest: its own level in the box again.
    await expect(again.getByRole('spinbutton')).toHaveValue('4.5')
  },
}

// ─── The average's other states ────────────────────────────────────────────

/** Set for December: its first month and level; nothing has counted, but it can change. */
export const AverageScheduled: Story = {
  args: { view: AVERAGE_SCHEDULED },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Average private rating',
      'h2 Changes',
    ])
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('December')).toBeVisible()
    await expect(tiles.getByText('Goal 4.5')).toBeVisible()
    await expect(tiles.getByText('Starts on Dec 1')).toBeVisible()
    await expect(changeTexts(canvas)).toEqual(['Nov 22 · Elena set 4.5 from December'])
    await expect(canvas.getByRole('button', { name: 'Change number' })).toBeVisible()
  },
}

/** Stopped on Nov 12: it says so, keeps its months and changes, and takes no action. */
export const AverageStopped: Story = {
  args: { view: AVERAGE_STOPPED },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped on Nov 12.')).toBeVisible()
    await expect(canvasElement.querySelector('[data-slot="metric-strip"]')).toBeNull()
    await expect(
      within(canvas.getByRole('list', { name: 'Month by month' })).getAllByRole('button'),
    ).toHaveLength(2)
    await expect(changeTexts(canvas)).toEqual([
      'Nov 12 · Elena stopped the goal',
      'Sep 28 · Elena set 4.5 from October',
    ])
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^More actions/u })).toBeNull()
  },
}

/** Reception's own average, made by an older form: whose it is, and where it counts. */
export const AverageForAPortal: Story = {
  args: { view: AVERAGE_RECEPTION },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)[0]).toBe('h1 Reception · Average private rating')
    await expect(
      canvas.getByText(
        'The average private rating guests give at Reception. A month needs at least 10 ratings.',
      ),
    ).toBeVisible()
  },
}

// ─── A goal for one portal (PLAN PG-21) ────────────────────────────────────

const subjectArgs = (view: typeof SINGLE_RECEPTION) => ({
  propertyId: SEAVIEW.propertyId,
  propertyName: SEAVIEW.name,
  page: view.page,
  canCreatePortal: true,
  canSeeResults: true,
  canChange: true,
  canStop: true,
  commands: { setMonthlyPortalGoalFn: fn(), onSet: fn(), openSheet: fn() },
  stop,
  personName,
  single: {
    title: singleGoalTitle(view.subject),
    name: singleSubjectWords(view.subject),
    where: subjectPlace(view.subject) ?? '',
    canSwitch: !view.otherMeasureHeld,
  },
})

/** Reception already holds a scans goal from December: no "Count scans instead". */
export const SinglePortalScansHeld: Story = {
  render: () => <PortalGoalPage {...subjectArgs(SINGLE_RECEPTION_SCANS_HELD)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Change number' })).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Reception · portal goal' }),
    )
    const body = within(document.body)
    await expect(
      await body.findByRole('menuitem', { name: 'Stop this goal…' }),
    ).toBeVisible()
    await expect(body.queryByRole('menuitem', { name: /instead/u })).toBeNull()
    await userEvent.keyboard('{Escape}')
  },
}

/** On a phone: the same page, and "How this goal counts" names Reception. */
export const SinglePortal320: Story = {
  render: () => <PortalGoalPage {...subjectArgs(SINGLE_RECEPTION)} />,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)[0]).toBe('h1 Reception · portal goal')
    await userEvent.click(canvas.getByRole('button', { name: 'How this goal counts' }))
    await expect(
      await canvas.findByText(
        /^Counts the 1–5 star private ratings guests give at Reception\. /u,
      ),
    ).toBeVisible()
  },
}

// ─── A goal for several subjects (PLAN PG-21) ──────────────────────────────

/** An older form's goal for Reception, Spa and Rooms: whom, this month, and Stop. */
export const SeveralSubjects: Story = {
  render: (args) => (
    <PortalGoalSeveralPage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={SEVERAL_RUNNING}
      canStop={args.canStop}
      stop={args.stop}
    />
  ),
  parameters: { viewport: { defaultViewport: 'tablet' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = 'Rooms (group) and 2 more · portal goal'
    await expect(outline(canvasElement)).toEqual([`h1 ${title}`])
    await expect(
      canvas.getByText('Private ratings from Rooms (group) and 2 more at Seaview Hotel.'),
    ).toBeVisible()
    await expect(canvas.getByText('3 subjects · 1 below pace')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await userEvent.click(
      canvas.getByRole('button', { name: `More actions for ${title}` }),
    )
    const body = within(document.body)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Stop this goal…' }))
    const dialog = await body.findByRole('alertdialog', {
      name: 'Stop this portal goal?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop the goal' }))
    await expect(stopMock).toHaveBeenCalledWith({
      data: { propertyId: SEAVIEW.propertyId, programId: 'program-several' },
    })
    await expectToast('Portal goal stopped')
    await waitFor(() => expect(onStoppedMock).toHaveBeenCalledOnce())
  },
}

/** The same, stopped: it says so, and takes no action. */
export const SeveralStopped: Story = {
  render: (args) => (
    <PortalGoalSeveralPage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={SEVERAL_STOPPED}
      canStop={args.canStop}
      stop={args.stop}
    />
  ),
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped on Nov 12.')).toBeVisible()
    await expect(canvas.queryByText(/below pace/u)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^More actions/u })).toBeNull()
  },
}
