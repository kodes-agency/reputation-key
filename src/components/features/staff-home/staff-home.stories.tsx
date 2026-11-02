import { useState, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within, userEvent } from 'storybook/test'
import { StaffHome } from './index'
import {
  STAFF_HOME_FIXTURE,
  STAFF_HOME_FNS,
  STAFF_RESULTS_FIXTURE,
} from './staff-home-fixtures'
import type { StaffHomeData, StaffHomeFns, StaffHomeSearch } from './types'

type StoryProps = Readonly<{
  width: number
  tab: 'code' | 'results'
  period: StaffHomeSearch['period']
  home: StaffHomeData
  fns: StaffHomeFns
}>
function Screen({ width, tab, period, home, fns }: StoryProps) {
  const [search, setSearch] = useState<StaffHomeSearch>({ tab, period })
  const acknowledged = useRef(false)
  return (
    <div style={{ width, maxWidth: '100%' }}>
      <StaffHome
        userId="polly"
        home={home}
        search={search}
        onSearch={setSearch}
        fns={{
          ...fns,
          getMyStaffHome: async () => ({
            participations: home.participations.map((row) => ({
              ...row,
              noticeAcknowledged: acknowledged.current || row.noticeAcknowledged,
            })),
          }),
          acknowledgeStaffNotice: async () => {
            acknowledged.current = true
            return { acknowledged: true }
          },
        }}
      />
    </div>
  )
}
const meta = {
  title: 'Staff/Home',
  component: Screen,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileStaff' } },
  args: {
    width: 375,
    tab: 'code',
    period: 'month',
    home: STAFF_HOME_FIXTURE,
    fns: STAFF_HOME_FNS,
  },
} satisfies Meta<typeof Screen>
export default meta
type Story = StoryObj<typeof meta>
export const Code: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('img', { name: 'Code for guests to scan' }),
    ).toBeVisible()
    await expect(canvas.queryByText('scans')).not.toBeInTheDocument()
  },
}
export const Code320: Story = {
  args: { width: 320 },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}
export const Code768: Story = {
  args: { width: 768 },
  parameters: { viewport: { defaultViewport: 'tablet' } },
}
export const Code1440: Story = {
  args: { width: 1440 },
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}
export const Paused: Story = {
  args: { fns: { ...STAFF_HOME_FNS, getMyCode: async () => ({ state: 'paused' }) } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Your code is paused. Ask your manager.'),
    ).toBeVisible()
  },
}
export const Today: Story = {
  args: { tab: 'results', period: 'today' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Ratings update each morning.'),
    ).toBeVisible()
    await expect(
      within(canvasElement).queryByLabelText('Your ratings'),
    ).not.toBeInTheDocument()
  },
}
export const WeekBelowFive: Story = {
  args: { tab: 'results', period: 'week' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('average, from 5 ratings'),
    ).toBeVisible()
    await expect(within(canvasElement).getByText('–')).toBeVisible()
  },
}
export const Month: Story = { args: { tab: 'results' } }
export const Month320: Story = { args: { tab: 'results', width: 320 } }
export const Month768: Story = { args: { tab: 'results', width: 768 } }
export const Month1440: Story = { args: { tab: 'results', width: 1440 } }
export const WithGoals: Story = {
  args: {
    tab: 'results',
    fns: {
      ...STAFF_HOME_FNS,
      getMyGoals: async () => ({
        goals: [
          { id: 'own', name: 'Your goal', scans: 47, target: 60 },
          { id: 'group', name: 'Reception', scans: 240, target: 400 },
        ],
      }),
    },
  },
}
export const WithColleagues: Story = {
  args: {
    tab: 'results',
    home: {
      participations: STAFF_HOME_FIXTURE.participations.map((row) => ({
        ...row,
        colleagueListEnabled: true,
      })),
    },
    fns: {
      ...STAFF_HOME_FNS,
      getMyColleagues: async () => ({
        colleagues: [
          { displayName: 'Alex Rivera', scans: 38, isYou: false },
          { displayName: 'Polly Smith', scans: 47, isYou: true },
        ],
      }),
    },
  },
}
export const Empty: Story = {
  args: {
    tab: 'results',
    fns: {
      ...STAFF_HOME_FNS,
      getMyResults: async () => ({
        ...STAFF_RESULTS_FIXTURE,
        scans: 0,
        ratingCount: 0,
        averageRating: undefined,
      }),
    },
  },
}
export const Notice: Story = {
  args: {
    home: {
      participations: STAFF_HOME_FIXTURE.participations.map((row) => ({
        ...row,
        noticeAcknowledged: false,
      })),
    },
  },
}
export const Notice320: Story = { ...Notice, args: { ...Notice.args, width: 320 } }
export const TwoProperties: Story = {
  args: {
    home: {
      participations: [
        ...STAFF_HOME_FIXTURE.participations,
        {
          ...STAFF_HOME_FIXTURE.participations[0]!,
          participationId: '22222222-2222-4222-8222-222222222222',
          propertyName: 'Harbor Spa',
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('combobox', { name: 'Property' }),
    ).toBeVisible()
  },
}
export const TwoProperties320: Story = {
  ...TwoProperties,
  args: { ...TwoProperties.args, width: 320 },
}

export const Paused320: Story = { ...Paused, args: { ...Paused.args, width: 320 } }
export const Today320: Story = { ...Today, args: { ...Today.args, width: 320 } }
export const WeekBelowFive320: Story = {
  ...WeekBelowFive,
  args: { ...WeekBelowFive.args, width: 320 },
}
export const WithGoals320: Story = {
  ...WithGoals,
  args: { ...WithGoals.args, width: 320 },
}
export const WithColleagues320: Story = {
  ...WithColleagues,
  args: { ...WithColleagues.args, width: 320 },
}
export const Empty320: Story = { ...Empty, args: { ...Empty.args, width: 320 } }
export const NoticeAcknowledgement: Story = {
  ...Notice,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(canvas.queryByRole('tab', { name: 'Code' })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Got it' }))
    await expect(await canvas.findByRole('tab', { name: 'Code' })).toBeVisible()
  },
}

export const PeriodChanges: Story = {
  args: { tab: 'results' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('4.6')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'Today' }))
    await expect(await canvas.findByText('Ratings update each morning.')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'This week' }))
    await expect(await canvas.findByText('average, from 5 ratings')).toBeVisible()
    await expect(canvas.queryByText('4.6')).not.toBeInTheDocument()
  },
}
