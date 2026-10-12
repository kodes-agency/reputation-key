import { InlineLink } from '#/components/ui/inline-link'
import { AuthCard } from '#/components/layout/auth-layout'

type Props = Readonly<{ organizationName?: string }>

/** Shown once an invitation is accepted, from the link or from the list. */
export function AcceptedView({ organizationName }: Props) {
  return (
    <AuthCard
      title="Welcome to the team!"
      description={
        organizationName
          ? `You've joined ${organizationName}.`
          : "You've successfully joined the organization."
      }
    >
      <div className="text-center">
        <InlineLink to="/properties" className="text-sm">
          Go to your workspace
        </InlineLink>
      </div>
    </AuthCard>
  )
}
