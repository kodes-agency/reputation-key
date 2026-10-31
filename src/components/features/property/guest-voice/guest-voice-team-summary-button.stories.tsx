import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent } from 'storybook/test'
import { GuestVoiceTeamSummaryButton } from './guest-voice-team-summary-button'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'
const meta = {
  title: 'Property/GuestVoice2/Team summary',
  component: GuestVoiceTeamSummaryButton,
  args: { read: HAMPTON_READ },
  parameters: { theme: 'light' },
} satisfies Meta<typeof GuestVoiceTeamSummaryButton>
export default meta
type Story = StoryObj<typeof meta>
export const CopyFailure: Story = {
  args: { copy: fn(async () => false) },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy team summary' }))
    const note = canvas.getByRole('textbox', {
      name: 'Team summary for manual copy',
    }) as HTMLTextAreaElement
    expect(note).toHaveFocus()
    expect(note.selectionStart).toBe(0)
    expect(note.selectionEnd).toBe(note.value.length)
    expect(note.value).not.toContain('musty smell')
    expect(canvas.getByRole('status')).toHaveTextContent('Couldn’t copy')
  },
}
export const Copied: Story = {
  args: { copy: fn(async () => true) },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy team summary' }))
    expect(canvas.getByRole('status')).toHaveTextContent('Team summary copied.')
  },
}
