import { Ban, Eye, Star, UsersRound } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

type Props = Readonly<{ pending: boolean; error: unknown; onAccept: () => void }>

const LINES = [
  {
    icon: <UsersRound />,
    text: 'Offer your code to every guest, not only those who seem happy.',
  },
  {
    icon: <Ban />,
    text: 'Never ask for a good rating, or for a guest to mention you.',
  },
  {
    icon: <Star />,
    text: "You aren't rewarded for high ratings. A high rating from very few guests, or no scans for a while, may prompt a chat.",
  },
  {
    icon: <Eye />,
    text: 'Your managers see your ratings and scans, the private notes guests leave through your code, and how many guests opened Google. If your manager turns on the staff list, colleagues here can see your scan count.',
  },
]

export function StaffNotice(props: Props) {
  return <StaffNoticeContent {...props} />
}

export function StaffNoticeContent({ pending, error, onAccept }: Props) {
  return (
    <section className="staff-step">
      <h1 className="staff-step__title">Before you start</h1>
      <ul className="staff-step__list">
        {LINES.map((line) => (
          <li key={line.text}>
            <span className="staff-step__glyph" aria-hidden="true">
              {line.icon}
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
      <div className="staff-step__foot">
        <FormErrorBanner error={error} />
        <Button pending={pending} pendingLabel="Saving…" onClick={onAccept}>
          Got it
        </Button>
        <InlineLink to="/privacy">Privacy notice</InlineLink>
      </div>
    </section>
  )
}
