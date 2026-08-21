// Browser previews of the three account emails. Same iframe treatment as the
// notification previews: these are documents, not fragments.
import type { Meta, StoryObj } from '@storybook/react'
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from './transactional'

type PreviewProps = Readonly<{ subject: string; html: string; text: string }>

const EmailPreview = ({ subject, html, text }: PreviewProps) => (
  <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Subject ({subject.length} chars)
      </p>
      <p className="text-sm text-foreground">{subject}</p>
    </div>
    <iframe
      title={`Email preview: ${subject}`}
      srcDoc={html}
      className="h-[680px] w-full rounded-xl border border-border"
    />
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Plain-text part
      </summary>
      <pre className="mt-3 text-xs whitespace-pre-wrap text-foreground">{text}</pre>
    </details>
  </div>
)

const meta: Meta<typeof EmailPreview> = {
  title: 'Email/Transactional',
  component: EmailPreview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', theme: 'light' },
}

export default meta
type Story = StoryObj<typeof EmailPreview>

export const Verification: Story = {
  args: renderVerificationEmail(
    'https://app.reputationkey.app/verify-email?token=7f3c9a2e4b81',
  ),
}

export const PasswordReset: Story = {
  args: renderPasswordResetEmail(
    'https://app.reputationkey.app/reset-password?token=41e0b7d5c2a9',
  ),
}

export const Invitation: Story = {
  args: renderInvitationEmail({
    invitedByUsername: 'Ada Lovelace',
    organizationName: 'Riverside Hospitality Group',
    inviteLink: 'https://app.reputationkey.app/accept-invitation?id=inv-8c21',
  }),
}
