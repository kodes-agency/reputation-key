import type { Meta, StoryObj } from '@storybook/react'
import { expect, within, userEvent } from 'storybook/test'
import { StaffStoryScreen } from './staff-story-screen'
import { STAFF_HOME_FIXTURE, STAFF_HOME_FNS } from './staff-home-fixtures'
import { STORY_HERO_PHOTO } from '#/components/features/guest/public-portal/immersive/__fixtures__/story-hero-photo'
import { STORY_LOGO } from '#/components/features/guest/public-portal/immersive/__fixtures__/story-logo'

const meta = {
  title: 'Staff/Phone looks',
  component: StaffStoryScreen,
  parameters: {
    layout: 'fullscreen',
    viewport: {
      viewports: {
        staffLandscape667: {
          name: '667 × 375',
          styles: { width: '667px', height: '375px' },
        },
        staffLandscape844: {
          name: '844 × 390',
          styles: { width: '844px', height: '390px' },
        },
        staffLandscape915: {
          name: '915 × 412',
          styles: { width: '915px', height: '412px' },
        },
      },
    },
  },
  args: {
    width: 375,
    tab: 'code',
    period: 'month',
    home: STAFF_HOME_FIXTURE,
    fns: STAFF_HOME_FNS,
  },
} satisfies Meta<typeof StaffStoryScreen>
export default meta
type Story = StoryObj<typeof meta>
const participation = STAFF_HOME_FIXTURE.participations[0]!
const branded = (
  look: Partial<typeof participation.look>,
  propertyName = participation.propertyName,
) => ({
  participations: [
    { ...participation, propertyName, look: { ...participation.look, ...look } },
  ],
})
export const Photo: Story = { args: { home: branded({ hero: STORY_HERO_PHOTO }) } }
export const NoPhoto: Story = {}
export const LongName: Story = {
  args: { home: branded({}, 'The Harbor Hotel and Spa on the Bay of Saint Constantine') },
}
export const Logo: Story = { args: { home: branded({ logo: STORY_LOGO }) } }
export const Restaurant: Story = {
  args: {
    home: branded(
      { accentColour: '#E58B6B', fieldColour: '#170E0B', wordmark: 'Harbor' },
      'Harbor Bistro',
    ),
  },
}
export const Salon: Story = {
  args: {
    home: branded(
      { accentColour: '#CDB4F0', fieldColour: '#120E18', wordmark: 'Luna' },
      'Luna Salon',
    ),
  },
}
export const DarkAccent: Story = {
  args: { home: branded({ accentColour: '#101010', fieldColour: '#FFFFFF' }) },
}
export const LastMonth: Story = {
  args: { tab: 'results', period: 'last_month', width: 320 },
}
export const NewAccount: Story = {
  args: {
    tab: 'results',
    fns: {
      ...STAFF_HOME_FNS,
      getMyResults: async () => ({ scans: 0, series: null, ratingCount: 0 }),
    },
  },
}
export const Loading: Story = {
  args: { fns: { ...STAFF_HOME_FNS, getMyCode: () => new Promise(() => undefined) } },
}
export const LoadError: Story = {
  args: {
    fns: {
      ...STAFF_HOME_FNS,
      getMyCode: async () => {
        throw new Error('Your code could not be loaded. Please try again.')
      },
    },
  },
}
export const RateLimited: Story = {
  args: {
    fns: {
      ...STAFF_HOME_FNS,
      getMyCode: async () => {
        throw new Error('Please wait before opening your code again.')
      },
    },
  },
}
function retainedCheck(message: string): Story {
  let reads = 0
  return {
    args: {
      fns: {
        ...STAFF_HOME_FNS,
        getMyCode: async (input) => {
          if (reads++ > 0) throw new Error(message)
          return STAFF_HOME_FNS.getMyCode(input)
        },
      },
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      const image = await canvas.findByRole('img', { name: 'Code for guests to scan' })
      const first = image.getAttribute('src')
      await userEvent.click(canvas.getByRole('tab', { name: 'My results' }))
      await userEvent.click(canvas.getByRole('tab', { name: 'Code' }))
      await expect(
        canvas.getByRole('img', { name: 'Code for guests to scan' }),
      ).toHaveAttribute('src', first)
    },
  }
}
export const FailedCheckKept: Story = retainedCheck('Could not check your code.')
export const RateLimitedKept: Story = retainedCheck(
  'Please wait before opening your code again.',
)
const landscape: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const image = await canvas.findByRole('img', { name: 'Code for guests to scan' })
  const box = image.getBoundingClientRect()
  await expect(box.width).toBeCloseTo(box.height, 0)
  await expect(box.width).toBeGreaterThan(200)
}
export const Landscape667: Story = {
  args: { width: 667 },
  parameters: { viewport: { defaultViewport: 'staffLandscape667' } },
  play: landscape,
}
export const Landscape844: Story = {
  args: { width: 844 },
  parameters: { viewport: { defaultViewport: 'staffLandscape844' } },
  play: landscape,
}
export const Landscape915: Story = {
  args: { width: 915 },
  parameters: { viewport: { defaultViewport: 'staffLandscape915' } },
  play: landscape,
}
