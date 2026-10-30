// The Guest voice row of Overview: one sentence and two chips.
//
// It reads the same v3 analysis as the Guest voice page. The states that matter here are
// the ones that must never render nothing at all: `disabled` and `preparing`, because
// "nothing" on the front page reads as a broken product rather than a young one
// (redesign row 12).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'
import type { getGuestVoiceV2Fn } from '#/contexts/ai/server/guest-voice-v2'
import { LARGE_READ } from './guest-voice/guest-voice-fixtures-large'
import { NOT_ENOUGH_READ } from './guest-voice/guest-voice-fixtures-small'
import { RAILING_ISSUE, URGENT_READ } from './guest-voice/guest-voice-fixtures-states'
import { overviewIssueCountText } from './overview-guest-voice-issues'
import { OverviewGuestVoice } from './overview-guest-voice'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const answering = (value: unknown) =>
  (async () => value) as unknown as typeof getGuestVoiceV2Fn

const FIX_FIRST = LARGE_READ.fixFirst[0]
const LOVED = LARGE_READ.guestsLove[0]
if (FIX_FIRST === undefined || LOVED === undefined) {
  throw new Error('The large Guest voice fixture must hold a problem and a strength')
}

const meta: Meta<typeof OverviewGuestVoice> = {
  title: 'Property/OverviewGuestVoice',
  component: OverviewGuestVoice,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: PROPERTY_ID,
    serverFns: { getGuestVoice: answering(LARGE_READ) },
  },
}
export default meta
type Story = StoryObj<typeof OverviewGuestVoice>

export const TopPraiseAndComplaint: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const firstLine = LARGE_READ.inShort[0]
    if (firstLine !== undefined) {
      expect(await canvas.findByText(firstLine.text)).toBeVisible()
    }
    expect(
      await canvas.findByRole('link', {
        name: `Complaints: ${overviewIssueCountText(FIX_FIRST)}; open in inbox`,
      }),
    ).toBeVisible()
    expect(
      canvas.getByRole('link', {
        name: `Praise: ${overviewIssueCountText(LOVED)}; open in inbox`,
      }),
    ).toBeVisible()
    expect(canvas.getByRole('link', { name: 'All topics' })).toBeVisible()
  },
}

export const UrgentIssueComesFirst: Story = {
  args: { serverFns: { getGuestVoice: answering(URGENT_READ) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('link', {
        name: `Complaints: ${overviewIssueCountText(RAILING_ISSUE)}; open in inbox`,
      }),
    ).toBeVisible()
  },
}

export const NothingStandsOut: Story = {
  args: {
    serverFns: {
      getGuestVoice: answering({
        ...LARGE_READ,
        urgent: [],
        fixFirst: [],
        guestsLove: [],
        inShort: [],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No issue or praise stands out/)).toBeVisible()
    expect(canvas.getByRole('link', { name: 'All topics' })).toBeVisible()
  },
}

export const TooFewReviews: Story = {
  args: { serverFns: { getGuestVoice: answering(NOT_ENOUGH_READ) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Too few reviews with text yet/)).toBeVisible()
  },
}

export const AnalysisOffWithAction: Story = {
  args: { serverFns: { getGuestVoice: answering({ status: 'disabled' }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/Turn on AI analysis to see what guests praise/),
    ).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Turn on AI analysis' })).toBeVisible()
  },
}

export const AnalysisOffWithoutPermission: Story = {
  args: AnalysisOffWithAction.args,
  // Only AccountAdmin holds `ai.manage`; a PropertyManager is told who can, like a Member.
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A manager who cannot turn it on is told who can, not shown a dead button.
    expect(await canvas.findByText(/An account admin can turn it on/)).toBeVisible()
    expect(canvas.queryByRole('link', { name: 'Turn on AI analysis' })).toBeNull()
  },
}

export const StillAnalysing: Story = {
  args: { serverFns: { getGuestVoice: answering({ status: 'preparing' }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Analysing your reviews/)).toBeVisible()
  },
}

export const NothingAnalysedYet: Story = {
  args: { serverFns: { getGuestVoice: answering({ status: 'not_v3' }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Analysing your reviews/)).toBeVisible()
  },
}

export const Unavailable: Story = {
  args: {
    serverFns: {
      // A rejected promise built at module scope would be unhandled before any story
      // mounts, which the storybook runner reports as a failure in whichever story ran
      // first.
      getGuestVoice: (() => {
        throw new Error('Guest voice unavailable')
      }) as unknown as typeof getGuestVoiceV2Fn,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Guest voice is unavailable right now/)).toBeVisible()
  },
}
