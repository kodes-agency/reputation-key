import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Questionnaire } from '#/components/ui/questionnaire'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import { SetupReplyVoiceQuestion } from './setup-reply-voice-question'

const property = {
  propertyId: '10000000-0000-4000-8000-000000000101',
  propertyName: 'Harbor Hotel',
  publicDisplayName: 'Harbor Hotel',
  publicDisplayNameConfirmed: true,
  countryCode: 'US',
  replyLanguage: 'en-Latn',
  aiDecided: true,
  managerIds: ['user-admin'],
  eligibleManagerIds: ['user-admin'],
  replyVoiceConfigured: false,
  replyVoice: resolveVoice(BUILTIN_REPLY_VOICE, null, null),
  replyVoiceVersion: { account: 0, property: 0 },
  propertyCount: 1,
} as const

const meta = {
  title: 'PropertySetup/Reply voice question',
  component: SetupReplyVoiceQuestion,
  decorators: [
    (Story) => (
      <Questionnaire aria-label="Reply voice setup">
        <Story />
      </Questionnaire>
    ),
  ],
  args: {
    properties: [property],
    answer: {
      useFirstName: true,
      signerName: '',
      signerTitle: '',
      contact: '',
      emojiMode: 'off',
    },
    disabled: false,
    onAnswerChange: fn(),
  },
} satisfies Meta<typeof SetupReplyVoiceQuestion>

export default meta
type Story = StoryObj<typeof meta>

export const FocusedStep: Story = {}
