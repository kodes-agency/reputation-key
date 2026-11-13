import type { Meta, StoryObj } from '@storybook/react'
import { StaffInstallContent } from './staff-install'
import { StaffSurface } from './staff-surface'
import { STAFF_HOME_FIXTURE } from './staff-home-fixtures'
const meta = {
  title: 'Staff/Keep your code',
  component: StaffInstallContent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <StaffSurface participation={STAFF_HOME_FIXTURE.participations[0]}>
        <Story />
      </StaffSurface>
    ),
  ],
  args: { kind: 'iphone', onInstall: () => undefined, onSkip: () => undefined },
} satisfies Meta<typeof StaffInstallContent>
export default meta
type Story = StoryObj<typeof meta>
export const IPhone: Story = {}
export const Android: Story = { args: { kind: 'android' } }
